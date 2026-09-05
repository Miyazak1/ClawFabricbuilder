import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { interruptedTaskContinuation } from '../features/builder/domain/builderInterruptedTask';
import {
  Bell,
  Bot,
  Compass,
  Copy,
  History,
  LayoutTemplate,
  MessageSquare,
  Minus,
  Rocket,
  Settings,
  ShieldCheck,
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
  BuilderAgentWorkbenchPort,
  BuilderAgentProjectTreePort,
  BuilderCheckRunAvailableResult,
  BuilderCheckRunApproveRequest,
  BuilderCheckRunEnvironmentDiagnosis,
  BuilderCheckRunDependencyPreparationDecision,
  BuilderCheckRunDependencyPreparationRequest,
  BuilderCheckRunPort,
  BuilderCheckRunProfile,
  BuilderCheckRunReadRequest,
  BuilderProjectEnvironmentDiagnosis,
  BuilderCommandApprovalRequest,
  BuilderCommandOutputEvent,
  BuilderCurrentProjectWriteApprovalStatus,
  BuilderGenerationOutputEvent,
  BuilderGenerationStartedEvent,
  BuilderAgentTestBrowserPort,
  BuilderLivePreviewPort,
  BuilderLivePreviewRequest,
  BuilderLivePreviewStatusProjection,
  BuilderLivePreviewViewBounds,
  BuilderUserWebPort,
  BuilderUserWebStatusProjection,
  BuilderPlanReviewPort,
  BuilderPlanReviewRequest,
  BuilderTaskStreamChangedEvent,
  BuilderTaskStreamPort,
  BuilderProjectWorkspacePort,
  BuilderSemanticRouteClassification,
  BuilderSideWorkspaceFileContentProjection,
  BuilderSideWorkspaceFilesPort,
  BuilderSideWorkspaceFileContentRequest,
  BuilderSideWorkspaceFileRef,
  BuilderSideWorkspaceFileRequest,
  BuilderSideWorkspaceRuntimeToolFileRequest,
  BuilderSideWorkspaceFileTreeProjection,
} from '../features/builder/application/builderPorts';
import { createBuilderGenerationRequest, type BuilderQueuedFollowupReference } from '../features/builder/application/builderGeneration';
import { BuilderDesktopCodeGeneratorPortError, createBuilderDesktopCodeGeneratorPort } from '../features/builder/infrastructure/builderDesktopCodeGeneratorPort';
import { BuilderDesktopAgentProjectTreePortError, createBuilderDesktopAgentProjectTreePort } from '../features/builder/infrastructure/builderDesktopAgentProjectTreePort';
import {
  BuilderDesktopAgentWorkbenchPortError,
  createBuilderDesktopAgentWorkbenchPort,
} from '../features/builder/infrastructure/builderDesktopAgentWorkbenchPort';
import {
  BuilderDesktopCheckRunPortError,
  createBuilderDesktopCheckRunPort,
} from '../features/builder/infrastructure/builderDesktopCheckRunPort';
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
  BuilderDesktopLivePreviewPortError,
  createBuilderDesktopLivePreviewPort,
} from '../features/builder/infrastructure/builderDesktopLivePreviewPort';
import {
  BuilderDesktopUserWebPortError,
  createBuilderDesktopUserWebPort,
} from '../features/builder/infrastructure/builderDesktopUserWebPort';
import {
  BuilderDesktopAgentTestBrowserPortError,
  createBuilderDesktopAgentTestBrowserPort,
} from '../features/builder/infrastructure/builderDesktopAgentTestBrowserPort';
import {
  BuilderDesktopSideWorkspaceFilesPortError,
  createBuilderDesktopSideWorkspaceFilesPort,
} from '../features/builder/infrastructure/builderDesktopSideWorkspaceFilesPort';
import {
  BuilderDesktopProviderSettingsPortError,
  createBuilderDesktopProviderSettingsPort,
  type BuilderProviderSettingsCurrent,
  type BuilderProviderSettingsPort,
} from '../features/builder/infrastructure/builderDesktopProviderSettingsPort';
import {
  type BuilderConversationControllerSnapshot,
} from '../features/builder/application/builderConversationController';
import {
  createBuilderLiveOutputStore,
  type BuilderLiveOutputSnapshot,
} from '../features/builder/application/builderLiveOutputStore';
import { createBuilderCommandOutputStore } from '../features/builder/application/builderCommandOutputStore';
import { incrementBuilderPerformance } from '../features/builder/application/builderPerformanceTrace';
import {
  createBuilderComposerRouteDecisionEvidence,
  decideBuilderComposerIntent,
  decideBuilderComposerSemanticIntent,
  isBuilderComposerContextualBuildIntent,
  isBuilderComposerPlanBuildConflictIntent,
  type BuilderComposerApprovalMode,
  type BuilderComposerRouteDecision,
  type BuilderComposerRouteDecisionEvidence,
} from '../features/builder/application/builderComposerIntent';
import { useBuilderConversationController } from '../features/builder/hooks/useBuilderConversationController';
import { useBuilderProjectCatalogController } from '../features/builder/hooks/useBuilderProjectCatalogController';
import { useBuilderAgentProjectTreeController } from '../features/builder/hooks/useBuilderAgentProjectTreeController';
import { useBuilderAgentWorkbenchController } from '../features/builder/hooks/useBuilderAgentWorkbenchController';
import { useBuilderProjectController } from '../features/builder/hooks/useBuilderProjectController';
import { useBuilderProjectHistoryController } from '../features/builder/hooks/useBuilderProjectHistoryController';
import { DEFAULT_BUILDER_AGENT_ID } from '../features/builder/domain/builderAgentProjectTreeProjection';
import {
  BuilderPage,
  type BuilderCheckEnvironmentDiagnosisView,
  type BuilderCheckRunOperationFailureCode,
  type BuilderCommandApprovalPrompt,
  type BuilderFileName,
  type BuilderPlanReviewInFlight,
  type BuilderPlanSourceReadApprovalPrompt,
  type BuilderTaskConversationSeed,
} from '../features/builder/presentation/BuilderPage';
import {
  builderDurableUserMessage,
  builderPendingUserMessageMatchesDurable,
  type BuilderPendingUserMessage,
} from '../features/builder/presentation/builderUserMessageReconciliation';
import type {
  BuilderComposerContextStatus,
  BuilderManualContextCompactionFeedback,
  BuilderComposerMode,
  BuilderComposerModelSelection,
  BuilderComposerWorkingBrief,
} from '../features/builder/presentation/BuilderComposer';
import { composerStatusFromContextProjection } from '../features/builder/domain/builderContextStatusProjection';
import type {
  BuilderAgentProjectTreeProjection,
  BuilderAgentTaskNode,
} from '../features/builder/domain/builderAgentProjectTreeProjection';
import type { BuilderAgentTaskMonitorItem } from '../features/builder/domain/builderAgentTaskMonitorProjection';
import type { BuilderAgentWorkbenchTaskProposalAction } from '../features/builder/domain/builderAgentWorkbenchProjection';
import type { BuilderProviderContextDisclosureStatusProjectionWire } from '../features/builder/domain/builderProviderContextDisclosureStatusProjection';
import {
  BuilderAgentSidebar,
  type BuilderTaskTranscriptExportFeedback,
} from '../features/builder/presentation/BuilderAgentSidebar';
import { BuilderAgentRoster } from '../features/builder/presentation/BuilderAgentRoster';
import { BuilderProviderSettingsRouteAdapter } from '../features/builder/presentation/BuilderProviderSettingsRouteAdapter';

const BUILDER_APP_ICON_SRC = 'app-icon.ico';

export type BuilderAppProps = Readonly<{
  bridgeRoot?: unknown;
}>;

type BuilderAppView = 'project' | 'settings';
type BuilderRailArea =
  | 'agents'
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
  { Icon: Bot, enabled: true, id: 'agents', label: 'Agents', view: 'project' },
  { Icon: History, enabled: false, id: 'runs', label: 'Runs', view: null },
  { Icon: LayoutTemplate, enabled: false, id: 'templates', label: 'Templates', view: null },
  { Icon: Compass, enabled: false, id: 'community', label: 'Explore', view: null },
  { Icon: UsersRound, enabled: false, id: 'spaces', label: 'Spaces', view: null },
  { Icon: Bell, enabled: false, id: 'activity', label: 'Activity', view: null },
  { Icon: Rocket, enabled: false, id: 'publish', label: 'Publish', view: null },
  { Icon: MessageSquare, enabled: false, id: 'contacts', label: 'Contacts', view: null },
  { Icon: Settings, enabled: true, id: 'settings', label: 'Settings', view: 'settings' },
]);

type BuilderEnvironmentDiagnosisSettingsCardProps = Readonly<{
  currentDraftId: string | null;
  diagnosis: BuilderCheckEnvironmentDiagnosisView | null;
  projectDiagnosis: BuilderProjectEnvironmentDiagnosisView | null;
  projectId: string | null;
  operation: 'loading' | 'running' | 'preparing_dependencies' | 'skipping' | 'failed' | null;
  operationFailureCode: BuilderCheckRunOperationFailureCode | null;
  profile: BuilderCheckRunProfile | null;
  onDiagnose: (profile: BuilderCheckRunProfile) => Promise<unknown> | void;
  onDiagnoseProject: (projectId: string) => Promise<unknown> | void;
  onPrepareDependencies: (
    decision: BuilderCheckRunDependencyPreparationDecision,
    profile: BuilderCheckRunProfile,
  ) => Promise<unknown> | void;
}>;

type BuilderProjectEnvironmentDiagnosisView = Readonly<{
  project_id: string;
  status: 'loading' | 'ready' | 'failed';
  diagnosis?: BuilderProjectEnvironmentDiagnosis;
  failure_message?: string;
}>;

type BuilderEnvironmentDiagnosisSettingsRow = Readonly<{
  key: string;
  label: string;
  value: string;
}>;

type BuilderEnvironmentDiagnosisSettingsSection = Readonly<{
  key: string;
  title: string;
  rows: readonly BuilderEnvironmentDiagnosisSettingsRow[];
}>;

function formatDiagnosisValue(value: string): string {
  if (value === 'npm' || value === 'pnpm' || value === 'yarn' || value === 'bun') return value;
  if (value === 'package-lock.json' || value === 'pnpm-lock.yaml' || value === 'yarn.lock'
    || value === 'bun.lock' || value === 'bun.lockb') return value;
  return value
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatToolchainValue(
  toolchain: BuilderProjectEnvironmentDiagnosis['toolchains']['node'],
): string {
  const label = formatDiagnosisValue(toolchain.state);
  return toolchain.version === null ? label : `${label} ${toolchain.version}`;
}

function diagnosisSections(
  diagnosis: BuilderCheckRunEnvironmentDiagnosis,
): readonly BuilderEnvironmentDiagnosisSettingsSection[] {
  return Object.freeze([
    {
      key: 'readiness',
      title: 'Readiness',
      rows: [
        { key: 'summary', label: 'Status', value: diagnosis.safe_summary },
        { key: 'primary_action', label: 'Next action', value: formatDiagnosisValue(diagnosis.primary_action) },
      ],
    },
    {
      key: 'toolchain',
      title: 'Host toolchain',
      rows: [
        { key: 'host_toolchain_state', label: 'Visibility', value: formatDiagnosisValue(diagnosis.host_toolchain_state) },
        { key: 'node', label: 'Node', value: diagnosis.host_node_version ?? formatDiagnosisValue(diagnosis.host_toolchain_state) },
        {
          key: 'package_manager',
          label: 'Package manager',
          value: diagnosis.host_package_manager_version === null
            ? diagnosis.package_manager
            : `${diagnosis.package_manager} ${diagnosis.host_package_manager_version}`,
        },
      ],
    },
    {
      key: 'project_dependencies',
      title: 'Project dependencies',
      rows: [
        { key: 'manifest', label: 'Manifest', value: formatDiagnosisValue(diagnosis.package_manifest) },
        { key: 'dependency_manifest', label: 'Declared dependencies', value: formatDiagnosisValue(diagnosis.dependency_manifest) },
        { key: 'lockfile', label: 'Lockfile', value: formatDiagnosisValue(diagnosis.lockfile) },
        { key: 'project_dependency_state', label: 'Project folder', value: formatDiagnosisValue(diagnosis.project_dependency_state) },
      ],
    },
    {
      key: 'check_workspace',
      title: 'Check workspace',
      rows: [
        {
          key: 'check_workspace_dependency_state',
          label: 'Isolated dependencies',
          value: formatDiagnosisValue(diagnosis.check_workspace_dependency_state),
        },
        { key: 'install_permission', label: 'Install permission', value: formatDiagnosisValue(diagnosis.install_permission) },
        { key: 'dependency_strategy', label: 'Strategy', value: formatDiagnosisValue(diagnosis.dependency_strategy) },
      ],
    },
  ]);
}

function projectDiagnosisSections(
  diagnosis: BuilderProjectEnvironmentDiagnosis,
): readonly BuilderEnvironmentDiagnosisSettingsSection[] {
  return Object.freeze([
    {
      key: 'readiness',
      title: 'Readiness',
      rows: [
        { key: 'summary', label: 'Status', value: diagnosis.safe_summary },
        { key: 'primary_action', label: 'Next action', value: formatDiagnosisValue(diagnosis.primary_action) },
      ],
    },
    {
      key: 'toolchain',
      title: 'Host toolchain',
      rows: [
        { key: 'node', label: 'Node', value: formatToolchainValue(diagnosis.toolchains.node) },
        { key: 'npm', label: 'npm', value: formatToolchainValue(diagnosis.toolchains.npm) },
        { key: 'pnpm', label: 'pnpm', value: formatToolchainValue(diagnosis.toolchains.pnpm) },
        { key: 'yarn', label: 'Yarn', value: formatToolchainValue(diagnosis.toolchains.yarn) },
        { key: 'git', label: 'Git', value: formatToolchainValue(diagnosis.toolchains.git) },
      ],
    },
    {
      key: 'project_dependencies',
      title: 'Project dependencies',
      rows: [
        { key: 'package_manager', label: 'Package manager', value: formatDiagnosisValue(diagnosis.package_manager) },
        { key: 'manifest', label: 'Manifest', value: formatDiagnosisValue(diagnosis.package_manifest) },
        { key: 'dependency_manifest', label: 'Declared dependencies', value: formatDiagnosisValue(diagnosis.dependency_manifest) },
        { key: 'lockfile', label: 'Lockfile', value: formatDiagnosisValue(diagnosis.lockfile) },
        { key: 'project_dependency_state', label: 'Project folder', value: formatDiagnosisValue(diagnosis.project_dependency_state) },
      ],
    },
  ]);
}

function settingsDiagnosisUnavailableMessage(
  currentDraftId: string | null,
  profile: BuilderCheckRunProfile | null,
  operation: BuilderEnvironmentDiagnosisSettingsCardProps['operation'],
  operationFailureCode: BuilderCheckRunOperationFailureCode | null,
): string | null {
  if (currentDraftId === null) {
    return 'No current draft is available. Diagnose reads the current project environment without preparing dependencies or running checks.';
  }
  if (operation === 'loading') {
    return 'Builder is discovering approved check commands for this draft.';
  }
  if (operation === 'failed' && profile === null) {
    return operationFailureCode === 'stale_draft'
      ? 'This draft changed before Builder could discover check commands. Return to the project and refresh the current draft.'
      : operationFailureCode === 'forbidden'
        ? 'The check discovery request did not come from the active Builder window.'
        : operationFailureCode === 'invalid_request'
          ? 'Builder could not verify the current draft check discovery request.'
          : operationFailureCode === 'busy'
            ? 'A project check is already running. Try diagnosis after it finishes.'
            : 'Builder could not discover approved check commands for this draft.';
  }
  if (profile === null) return 'No approved check command is available for the current draft.';
  return null;
}

function BuilderEnvironmentDiagnosisSettingsCard({
  currentDraftId,
  diagnosis,
  projectDiagnosis,
  projectId,
  operation,
  operationFailureCode,
  profile,
  onDiagnose,
  onDiagnoseProject,
  onPrepareDependencies,
}: BuilderEnvironmentDiagnosisSettingsCardProps) {
  const visibleDiagnosis = profile !== null
    && diagnosis?.command_profile_id === profile.command_profile_id
    ? diagnosis
    : null;
  const visibleProjectDiagnosis = projectId !== null
    && projectDiagnosis?.project_id === projectId
    ? projectDiagnosis
    : null;
  const usesProjectDiagnosis = currentDraftId === null;
  const disabled = usesProjectDiagnosis
    ? projectId === null || visibleProjectDiagnosis?.status === 'loading'
    : profile === null || visibleDiagnosis?.status === 'loading';
  const unavailableMessage = settingsDiagnosisUnavailableMessage(
    currentDraftId,
    profile,
    operation,
    operationFailureCode,
  );
  const sections = usesProjectDiagnosis
    ? visibleProjectDiagnosis?.diagnosis === undefined
      ? null
      : projectDiagnosisSections(visibleProjectDiagnosis.diagnosis)
    : visibleDiagnosis?.diagnosis === undefined
      ? null
      : diagnosisSections(visibleDiagnosis.diagnosis);
  const diagnosisFailed = usesProjectDiagnosis
    ? visibleProjectDiagnosis?.status === 'failed'
    : visibleDiagnosis?.status === 'failed';
  const diagnosisFailureMessage = usesProjectDiagnosis
    ? visibleProjectDiagnosis?.failure_message
    : visibleDiagnosis?.failure_message;
  const diagnosisStatus = usesProjectDiagnosis
    ? visibleProjectDiagnosis?.status
    : visibleDiagnosis?.status;
  const canPrepareFromCurrentDraftDiagnosis = !usesProjectDiagnosis
    && profile !== null
    && visibleDiagnosis?.status === 'ready'
    && visibleDiagnosis.diagnosis?.primary_action === 'prepare_once';

  return (
    <section
      aria-labelledby="builder-environment-diagnosis-settings-title"
      className="cf-builder-panel cf-builder-settings-card border"
      data-builder-environment-diagnosis-settings="true"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Environment</p>
          <h2 className="text-sm font-semibold" id="builder-environment-diagnosis-settings-title">
            Dependencies and checks
          </h2>
        </div>
        <button
          className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-settings-diagnose-environment="true"
          disabled={disabled}
          onClick={() => {
            if (usesProjectDiagnosis) {
              if (projectId !== null) void onDiagnoseProject(projectId);
              return;
            }
            if (profile !== null) void onDiagnose(profile);
          }}
          type="button"
        >
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          {diagnosisStatus === 'loading' ? 'Checking...' : 'Diagnose'}
        </button>
      </header>
      <div className="cf-builder-settings-sections">
        <section>
          <h3 className="text-xs font-semibold">Current check</h3>
          <p className="text-sm text-muted-foreground">
            {usesProjectDiagnosis
              ? 'Project environment'
              : profile === null ? 'No check selected.' : profile.command_display}
          </p>
        </section>
        {unavailableMessage === null ? null : (
          <p className="text-sm text-muted-foreground" data-builder-settings-environment-unavailable="true">
            {unavailableMessage}
          </p>
        )}
        {diagnosisFailed ? (
          <p
            className="cf-builder-alert cf-builder-alert-danger text-sm"
            data-builder-settings-environment-diagnosis-failed="true"
            role="alert"
          >
            {diagnosisFailureMessage ?? 'I could not read the environment diagnosis. Try again.'}
          </p>
        ) : null}
        {sections === null ? null : (
          <div
            className="grid gap-3 text-sm"
            data-builder-settings-environment-diagnosis={diagnosisStatus}
            data-builder-settings-environment-primary-action={usesProjectDiagnosis
              ? visibleProjectDiagnosis?.diagnosis?.primary_action
              : visibleDiagnosis?.diagnosis?.primary_action}
          >
            {sections.map((section) => (
              <section
                className="grid gap-2 rounded-md border border-border/70 p-3"
                data-builder-settings-environment-section={section.key}
                key={section.key}
              >
                <h3 className="text-xs font-semibold">{section.title}</h3>
                <dl className="grid gap-1.5">
                  {section.rows.map((row) => (
                    <div
                      className="grid grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] gap-2"
                      data-builder-settings-environment-row={row.key}
                      key={row.key}
                    >
                      <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        )}
        {usesProjectDiagnosis
        && visibleProjectDiagnosis?.status === 'ready'
        && visibleProjectDiagnosis.diagnosis?.primary_action === 'show_project_dependency_setup' ? (
          <p
            className="text-xs text-muted-foreground"
            data-builder-settings-project-dependency-setup-read-only="true"
          >
            Project dependency setup is available from the project surface. Settings only diagnoses and never installs into the project folder.
          </p>
        ) : null}
        {canPrepareFromCurrentDraftDiagnosis ? (
          <div className="flex justify-end">
            <button
              className="cf-builder-primary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-settings-prepare-dependencies="true"
              disabled={operation === 'preparing_dependencies'}
              onClick={() => {
                void onPrepareDependencies('allow_once', profile);
              }}
              type="button"
            >
              {operation === 'preparing_dependencies' ? 'Preparing...' : 'Prepare once'}
            </button>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {canPrepareFromCurrentDraftDiagnosis
            ? 'Prepare once installs only in the isolated check workspace for this draft, then reruns the selected check.'
            : 'Diagnosis is read-only. Any dependency preparation still requires the scoped Prepare once approval.'}
        </p>
      </div>
    </section>
  );
}

const UNAVAILABLE_ROOT: BuilderDesktopBridgeRoot = Object.freeze({
  bridgeVersion: 'builder-preload.v0',
  agentProjectTree: null,
  agentWorkbench: null,
  codeGenerator: null,
  projectWorkspace: null,
  providerSettings: null,
  permissions: null,
  planReview: null,
  providerContextDisclosureApproval: null,
  checkRun: null,
  livePreview: null,
  agentTestBrowser: null,
  userWeb: null,
  sideWorkspaceFiles: null,
  taskStream: null,
  windowControls: null,
});

type BuilderWindowControlsBridge = Readonly<{
  close(): Promise<unknown>;
  minimize(): Promise<unknown>;
  readState(): Promise<unknown>;
  toggleMaximize(): Promise<unknown>;
}>;
type BuilderProviderContextDisclosureApprovalBridge = Readonly<{
  approveCurrent(request: Readonly<{ project_id: string; conversation_id: string }>): Promise<unknown>;
}>;

const WINDOW_CONTROL_KEYS = new Set(['close', 'minimize', 'readState', 'toggleMaximize']);
const PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_KEYS = new Set(['approveCurrent']);
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

const UNAVAILABLE_AGENT_PROJECT_TREE: BuilderAgentProjectTreePort = Object.freeze({
  read(request: Parameters<BuilderAgentProjectTreePort['read']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentProjectTreePortError());
  },
  renameProject(request: Parameters<BuilderAgentProjectTreePort['renameProject']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentProjectTreePortError());
  },
  archiveProject(request: Parameters<BuilderAgentProjectTreePort['archiveProject']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentProjectTreePortError());
  },
  renameTask(request: Parameters<BuilderAgentProjectTreePort['renameTask']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentProjectTreePortError());
  },
  archiveTask(request: Parameters<BuilderAgentProjectTreePort['archiveTask']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentProjectTreePortError());
  },
  exportTaskTranscript(request: Parameters<BuilderAgentProjectTreePort['exportTaskTranscript']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentProjectTreePortError());
  },
});

const UNAVAILABLE_AGENT_WORKBENCH: BuilderAgentWorkbenchPort = Object.freeze({
  read(request: Parameters<BuilderAgentWorkbenchPort['read']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentWorkbenchPortError());
  },
  updateMessageState(request: Parameters<BuilderAgentWorkbenchPort['updateMessageState']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentWorkbenchPortError());
  },
  createTaskProposal(request: Parameters<BuilderAgentWorkbenchPort['createTaskProposal']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentWorkbenchPortError());
  },
  decideTaskProposal(request: Parameters<BuilderAgentWorkbenchPort['decideTaskProposal']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentWorkbenchPortError());
  },
  decideAgentPlan(request: Parameters<BuilderAgentWorkbenchPort['decideAgentPlan']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentWorkbenchPortError());
  },
  controlTask(request: Parameters<BuilderAgentWorkbenchPort['controlTask']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentWorkbenchPortError());
  },
  subscribeChanged() {
    return () => undefined;
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
  answerPlan(request: Parameters<NonNullable<BuilderCodeGeneratorPort['answerPlan']>>[0]) {
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
  restorePreviousCheckpointAsDraft(
    request: Parameters<NonNullable<BuilderCodeGeneratorPort['restorePreviousCheckpointAsDraft']>>[0],
  ) {
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
  queueFollowup(request: Parameters<BuilderCodeGeneratorPort['queueFollowup']>[0]) {
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

const UNAVAILABLE_LIVE_PREVIEW: BuilderLivePreviewPort = Object.freeze({
  requestCurrentDraftPreview(request: BuilderLivePreviewRequest) {
    void request;
    return Promise.reject(new BuilderDesktopLivePreviewPortError());
  },
  reloadCurrentPreview(request: BuilderLivePreviewRequest) {
    void request;
    return Promise.reject(new BuilderDesktopLivePreviewPortError());
  },
  stopCurrentPreview(request: BuilderLivePreviewRequest) {
    void request;
    return Promise.reject(new BuilderDesktopLivePreviewPortError());
  },
  readCurrentPreviewStatus(request: BuilderLivePreviewRequest) {
    void request;
    return Promise.reject(new BuilderDesktopLivePreviewPortError());
  },
  decideDevServerApproval(request: Parameters<BuilderLivePreviewPort['decideDevServerApproval']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopLivePreviewPortError());
  },
  updateCurrentPreviewLayout(request: Parameters<BuilderLivePreviewPort['updateCurrentPreviewLayout']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopLivePreviewPortError());
  },
});

const UNAVAILABLE_USER_WEB: BuilderUserWebPort = Object.freeze({
  navigate(request: Parameters<BuilderUserWebPort['navigate']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopUserWebPortError());
  },
  goBack() { return Promise.reject(new BuilderDesktopUserWebPortError()); },
  goForward() { return Promise.reject(new BuilderDesktopUserWebPortError()); },
  reload() { return Promise.reject(new BuilderDesktopUserWebPortError()); },
  stop() { return Promise.reject(new BuilderDesktopUserWebPortError()); },
  readStatus() { return Promise.reject(new BuilderDesktopUserWebPortError()); },
  updateLayout(request: Parameters<BuilderUserWebPort['updateLayout']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopUserWebPortError());
  },
});

const UNAVAILABLE_AGENT_TEST_BROWSER: BuilderAgentTestBrowserPort = Object.freeze({
  stop(request: Parameters<BuilderAgentTestBrowserPort['stop']>[0]) {
    return Promise.resolve({ closed: false, owner_run_id: request.owner_run_id });
  },
  subscribeLifecycle() { return () => undefined; },
  updateLayout(request: Parameters<BuilderAgentTestBrowserPort['updateLayout']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopAgentTestBrowserPortError());
  },
});

const UNAVAILABLE_CHECK_RUN: BuilderCheckRunPort = Object.freeze({
  readCurrentDraftAvailableChecks(request: BuilderCheckRunReadRequest) {
    void request;
    return Promise.reject(new BuilderDesktopCheckRunPortError());
  },
  approveAndRunCurrentDraftCheck(request: BuilderCheckRunApproveRequest) {
    void request;
    return Promise.reject(new BuilderDesktopCheckRunPortError());
  },
  diagnoseCurrentDraftCheckEnvironment(request: BuilderCheckRunApproveRequest) {
    void request;
    return Promise.reject(new BuilderDesktopCheckRunPortError());
  },
  diagnoseProjectEnvironment(request: Readonly<{ project_id: string }>) {
    void request;
    return Promise.reject(new BuilderDesktopCheckRunPortError());
  },
  prepareProjectDependencies(request: Readonly<{ project_id: string }>) {
    void request;
    return Promise.reject(new BuilderDesktopCheckRunPortError());
  },
  decideCurrentDraftDependencyPreparation(request: BuilderCheckRunDependencyPreparationRequest) {
    void request;
    return Promise.reject(new BuilderDesktopCheckRunPortError());
  },
  skipCurrentDraftCheck(request: BuilderCheckRunReadRequest) {
    void request;
    return Promise.reject(new BuilderDesktopCheckRunPortError());
  },
});

function classifyCheckRunOperationFailureCode(error: unknown): BuilderCheckRunOperationFailureCode {
  if (error instanceof BuilderDesktopCheckRunPortError) {
    if (error.code === 'builder_check_run_approval_busy') return 'busy';
    if (error.code === 'builder_check_run_current_draft_failed') return 'stale_draft';
    if (error.code === 'builder_check_run_approval_invalid') return 'invalid_request';
    if (error.code === 'builder_check_run_approval_forbidden') return 'forbidden';
  }
  return 'unavailable';
}

const UNAVAILABLE_SIDE_WORKSPACE_FILES: BuilderSideWorkspaceFilesPort = Object.freeze({
  readCurrentDraftFileTree(request: BuilderSideWorkspaceFileRequest) {
    void request;
    return Promise.reject(new BuilderDesktopSideWorkspaceFilesPortError());
  },
  readCurrentDraftFileContent(request: BuilderSideWorkspaceFileContentRequest) {
    void request;
    return Promise.reject(new BuilderDesktopSideWorkspaceFilesPortError());
  },
  readRuntimeToolFileTree(request: BuilderSideWorkspaceRuntimeToolFileRequest) {
    void request;
    return Promise.reject(new BuilderDesktopSideWorkspaceFilesPortError());
  },
});

const UNAVAILABLE_PROVIDER_SETTINGS: BuilderProviderSettingsPort = Object.freeze({
  readCurrent() {
    return Promise.reject(new BuilderDesktopProviderSettingsPortError());
  },
  replaceCurrent(request) {
    void request;
    return Promise.reject(new BuilderDesktopProviderSettingsPortError());
  },
  selectModel(request) {
    void request;
    return Promise.reject(new BuilderDesktopProviderSettingsPortError());
  },
  status() {
    return Promise.reject(new BuilderDesktopProviderSettingsPortError());
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
  let agentProjectTree = UNAVAILABLE_AGENT_PROJECT_TREE;
  let agentWorkbench = UNAVAILABLE_AGENT_WORKBENCH;
  let workspace = UNAVAILABLE_WORKSPACE;
  let generator = UNAVAILABLE_GENERATOR;
  let taskStream = UNAVAILABLE_TASK_STREAM;
  let planReview = UNAVAILABLE_PLAN_REVIEW;
  let livePreview = UNAVAILABLE_LIVE_PREVIEW;
  let agentTestBrowser = UNAVAILABLE_AGENT_TEST_BROWSER;
  let userWeb = UNAVAILABLE_USER_WEB;
  let checkRun = UNAVAILABLE_CHECK_RUN;
  let sideWorkspaceFiles = UNAVAILABLE_SIDE_WORKSPACE_FILES;
  let providerSettings = UNAVAILABLE_PROVIDER_SETTINGS;
  try {
    agentProjectTree = createBuilderDesktopAgentProjectTreePort(root.agentProjectTree);
  } catch {
    agentProjectTree = UNAVAILABLE_AGENT_PROJECT_TREE;
  }
  try {
    agentWorkbench = createBuilderDesktopAgentWorkbenchPort(root.agentWorkbench);
  } catch {
    agentWorkbench = UNAVAILABLE_AGENT_WORKBENCH;
  }
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
  try {
    livePreview = createBuilderDesktopLivePreviewPort(root.livePreview);
  } catch {
    livePreview = UNAVAILABLE_LIVE_PREVIEW;
  }
  try {
    agentTestBrowser = createBuilderDesktopAgentTestBrowserPort(root.agentTestBrowser);
  } catch {
    agentTestBrowser = UNAVAILABLE_AGENT_TEST_BROWSER;
  }
  try {
    userWeb = createBuilderDesktopUserWebPort(root.userWeb);
  } catch {
    userWeb = UNAVAILABLE_USER_WEB;
  }
  try {
    checkRun = createBuilderDesktopCheckRunPort(root.checkRun);
  } catch {
    checkRun = UNAVAILABLE_CHECK_RUN;
  }
  try {
    sideWorkspaceFiles = createBuilderDesktopSideWorkspaceFilesPort(root.sideWorkspaceFiles);
  } catch {
    sideWorkspaceFiles = UNAVAILABLE_SIDE_WORKSPACE_FILES;
  }
  try {
    providerSettings = createBuilderDesktopProviderSettingsPort(root.providerSettings);
  } catch {
    providerSettings = UNAVAILABLE_PROVIDER_SETTINGS;
  }
  return Object.freeze({
    agentProjectTree,
    agentWorkbench,
    agentTestBrowser,
    checkRun,
    generator,
    livePreview,
    userWeb,
    planReview,
    providerSettings,
    sideWorkspaceFiles,
    taskStream,
    workspace,
  });
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
    ?? snapshot.conversationProjectId
    ?? snapshot.workingProjectId
    ?? null;
}

function firstTaskAddressForProject(
  tree: ReturnType<typeof useBuilderAgentProjectTreeController>['snapshot']['tree'],
  projectId: string,
): string | null {
  if (tree === null) return null;
  return tree.projects.find((candidate) => candidate.project_id === projectId)
    ?.tasks[0]?.task_address_id
    ?? null;
}

function taskForAddress(
  tree: BuilderAgentProjectTreeProjection | null,
  taskAddressId: string | null,
): BuilderAgentTaskNode | null {
  if (tree === null || taskAddressId === null) return null;
  for (const project of tree.projects) {
    const task = project.tasks.find((candidate) => candidate.task_address_id === taskAddressId);
    if (task !== undefined) return task;
  }
  return tree.orphaned_tasks.find(
    (candidate) => candidate.task_address_id === taskAddressId,
  ) ?? null;
}

function taskConversationSeed(
  task: BuilderAgentTaskNode | BuilderAgentTaskMonitorItem | null,
): BuilderTaskConversationSeed | null {
  if (task === null) return null;
  return Object.freeze({
    task_address_id: task.task_address_id,
    conversation_id: task.conversation_id,
    goal: task.goal,
    waiting_to_start: 'status' in task ? task.status === 'draft' : task.state === 'draft',
  });
}

function composerModeForAgentTaskProposal(
  action: Pick<BuilderAgentWorkbenchTaskProposalAction, 'requested_outcome'>,
): BuilderComposerMode | null {
  if (action.requested_outcome === 'plan') return 'plan';
  if (action.requested_outcome === 'build') return 'build';
  return null;
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
type PendingAgentTaskHandoffStart = Readonly<{
  autoApproveCurrentProjectWrite: boolean;
  composerMode: BuilderComposerMode | null;
  epoch: number;
  instruction: string;
  messageId: string;
  projectId: string;
  taskAddressId: string;
}>;

type QueuedActiveRunFollowup = Readonly<{
  epoch: number;
  instruction: string;
  messageId: string;
  queuedFollowup: BuilderQueuedFollowupReference;
}>;

type PendingUserMessageTarget = Readonly<{
  epoch: number;
  minimum_sequence: number;
  projectId: string | null;
  taskAddressId: string | null;
}>;

type PendingUserMessage = BuilderPendingUserMessage & PendingUserMessageTarget;

function conversationHeadSequence(snapshot: BuilderConversationControllerSnapshot): number {
  return snapshot.conversation?.state === 'ready'
    ? snapshot.conversation.conversation.head_sequence
    : -1;
}

type RestorableDraftTarget = Readonly<{
  draftId: string;
  projectId: string;
  restoreKey: string;
}>;

type WorkbenchDraftReturnTarget = RestorableDraftTarget & Readonly<{
  epoch: number;
  taskAddressId: string;
}>;

type SubmitInstructionTextOptions = Readonly<{
  composerModeOverride?: BuilderComposerMode | null;
  existingMessageId?: string | null;
  queuedFollowup?: BuilderQueuedFollowupReference | null;
}>;

type SubmitInstructionText = (
  submittedIdea: string,
  options?: SubmitInstructionTextOptions,
) => Promise<void>;

type LockedComposerSubmit = Readonly<{
  epoch: number;
  instruction: string;
  options: SubmitInstructionTextOptions;
}>;

type BuilderApprovedPlanContinuation = Readonly<{
  project_id: string;
  conversation_id: string;
  turn_id: string;
  run_id: string;
}>;

type BuilderCurrentProjectWriteApprovalPrompt = Readonly<{
  interruptedRunId?: string;
  composerMode: BuilderComposerMode | null;
  project_id: string;
  instruction: string;
  message_id: string;
  queuedFollowup: BuilderQueuedFollowupReference | null;
  approvedPlanContinuation: BuilderApprovedPlanContinuation | null;
  state: 'pending' | 'approving' | 'failed';
}>;

const CHECK_RUN_DISCOVERY_MAX_ATTEMPTS = 12;
const CHECK_RUN_DISCOVERY_RETRY_DELAY_MS = 100;
const SIDE_WORKSPACE_FILE_DISCOVERY_MAX_ATTEMPTS = 20;
const SIDE_WORKSPACE_FILE_DISCOVERY_RETRY_DELAY_MS = 250;
const POST_TERMINAL_REFRESH_TIMEOUT_MS = 1_500;

function boundedPostTerminalRefresh<T>(operation: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(value);
    };
    const timeoutId = window.setTimeout(
      () => finish(fallback),
      POST_TERMINAL_REFRESH_TIMEOUT_MS,
    );
    void operation.then(finish, () => finish(fallback));
  });
}

function latestRestorableDraft(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
): RestorableDraftTarget | null {
  const visibleProjectId = visibleConversationProjectId(projectSnapshot);
  if (visibleProjectId === null) return null;
  return latestRestorableDraftForProjectId(conversationSnapshot, projectSnapshot, visibleProjectId);
}

function latestRestorableDraftForProjectId(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
  visibleProjectId: string,
): RestorableDraftTarget | null {
  if (
    projectSnapshot.busy
    || projectSnapshot.draft !== null
    || projectSnapshot.inspectedRevision !== null
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
      // Only the newest candidate-producing run can represent recoverable work.
      // Once that candidate has a terminal review, older failed or superseded
      // candidates must never be resurrected as the current draft.
      if (reviewedDraftIds.has(item.candidate.draft_id)) return null;
      if (savedTarget !== null && item.turn_id === savedTarget.turn_id && item.run_id === savedTarget.run_id) {
        return null;
      }
      return Object.freeze({
        draftId: item.candidate.draft_id,
        projectId: visibleProjectId,
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

function hasPendingDraftRestoreProjectionHint(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  visibleProjectId: string,
): boolean {
  if (
    conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
    || conversationSnapshot.project_id !== visibleProjectId
  ) return false;
  const reviewState = conversationSnapshot.conversation.review_state_projection ?? null;
  if (
    reviewState !== null
    && reviewState.draft_id.length > 0
    && (reviewState.can_discard || reviewState.can_save)
  ) return true;
  const checkpointStatus = conversationSnapshot.conversation.draft_checkpoint_status_projection ?? null;
  return checkpointStatus !== null
    && checkpointStatus.status === 'ready'
    && (checkpointStatus.can_restore || checkpointStatus.can_save_version);
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
    conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
    || (visibleProjectId === null
      ? conversationSnapshot.project_id !== null
        || conversationSnapshot.conversation.scope_kind !== 'agent_conversation'
      : conversationSnapshot.project_id !== visibleProjectId)
  ) return false;

  let hasContext = false;
  const agentContextTurns = new Set<string>();
  for (const item of conversationSnapshot.conversation.conversation.items) {
    if (item.item_kind === 'transcript_message') {
      if (
        item.role === 'user'
        && item.message_kind === 'submitted'
        && item.context_route === 'update_brief'
      ) {
        agentContextTurns.add(item.turn_id);
      } else if (
        item.role === 'assistant'
        && item.message_kind === 'run_result'
        && agentContextTurns.has(item.turn_id)
      ) {
        hasContext = true;
      }
      continue;
    }
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

const PENDING_BUILD_CONFIRMATION_PATTERN =
  /(?:需要我|要我|要不要我|是否(?:需要|要)我|我可以|可以帮你|如果你想).{0,64}(?:直接|现在|马上)?(?:修改|调整|更改|改|应用|生成|创建|实现|写|做|开始)|(?:would you like|do you want me to|should i|i can).{0,96}(?:change|modify|apply|build|create|implement|update|make|write)/iu;
const MAX_PENDING_DRAFT_RESTORE_ATTEMPTS = 20;
const MAX_PENDING_DRAFT_ACTIVITY_LOAD_ATTEMPTS = 20;
const PENDING_DRAFT_RESTORE_RETRY_DELAY_MS = 250;

function hasPendingBuildConfirmationContext(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
): boolean {
  const visibleProjectId = visibleConversationProjectId(projectSnapshot);
  if (
    visibleProjectId === null
    || conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
    || conversationSnapshot.project_id !== visibleProjectId
    || !hasPriorBuildContext(conversationSnapshot, projectSnapshot)
  ) return false;

  let latestUserSequence = 0;
  let latestProposalSequence = 0;
  for (const item of conversationSnapshot.conversation.conversation.items) {
    if (item.item_kind === 'user_message' && item.message_kind === 'submitted') {
      latestUserSequence = item.sequence;
      latestProposalSequence = 0;
      continue;
    }
    if (
      item.item_kind === 'run_completed'
      && item.terminal_status === 'succeeded'
      && item.result_kind === 'explanation'
      && item.assistant_message !== null
      && item.sequence > latestUserSequence
      && PENDING_BUILD_CONFIRMATION_PATTERN.test(item.assistant_message.text.trim().normalize('NFKC'))
    ) {
      latestProposalSequence = item.sequence;
    }
  }
  return latestProposalSequence > latestUserSequence;
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

function taskStreamRunKey(item: Readonly<{ turn_id: string; run_id: string }>): string {
  return `${item.turn_id}:${item.run_id}`;
}

function composerWorkingBrief(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
): BuilderComposerWorkingBrief | null {
  const visibleProjectId = visibleConversationProjectId(projectSnapshot);
  if (
    conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
  ) return null;

  if (visibleProjectId === null) {
    if (
      conversationSnapshot.project_id !== null
      || conversationSnapshot.conversation.scope_kind !== 'agent_conversation'
    ) return null;
    const contextTurns = new Set<string>();
    let latestAgentBrief: Readonly<{ sequence: number; text: string }> | null = null;
    for (const item of conversationSnapshot.conversation.conversation.items) {
      if (item.item_kind !== 'transcript_message') continue;
      if (
        item.role === 'user'
        && item.message_kind === 'submitted'
        && item.context_route === 'update_brief'
      ) {
        contextTurns.add(item.turn_id);
        continue;
      }
      if (
        item.role === 'assistant'
        && item.message_kind === 'run_result'
        && contextTurns.has(item.turn_id)
      ) {
        const text = compactComposerBriefText(item.message.text);
        if (text !== null) latestAgentBrief = Object.freeze({ sequence: item.sequence, text });
      }
    }
    if (latestAgentBrief === null) return null;
    return Object.freeze({
      key: `${conversationSnapshot.agent_id}:discussed-direction:${latestAgentBrief.sequence}`,
      label: 'Discussed direction',
      summary: latestAgentBrief.text,
      taskId: null,
    });
  }

  if (conversationSnapshot.project_id !== visibleProjectId) return null;

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

function composerWorkingContextStatus(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
): BuilderComposerContextStatus {
  const visibleProjectId = visibleConversationProjectId(projectSnapshot);
  if (
    visibleProjectId === null
    || conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
    || conversationSnapshot.project_id !== visibleProjectId
  ) return projectSnapshot.draft !== null ? 'ready_to_execute' : null;

  const projectedStatus = composerStatusFromContextProjection(
    conversationSnapshot.conversation.context_status_projection,
  );
  if (projectedStatus !== null) return projectedStatus;

  let latestStatus: BuilderComposerContextStatus = projectSnapshot.draft !== null ? 'ready_to_execute' : null;
  for (const item of conversationSnapshot.conversation.conversation.items) {
    if (item.item_kind === 'task_brief_updated') {
      latestStatus = item.brief.contextual_build_ready
        ? 'ready_to_execute'
        : 'direction_changed';
      continue;
    }
    if (item.item_kind === 'run_completed') {
      if (item.result_kind === 'candidate' && item.candidate !== null) {
        latestStatus = 'ready_to_execute';
        continue;
      }
      if (item.result_kind === 'plan') {
        latestStatus = 'needs_confirmation';
      }
      continue;
    }
    if (item.item_kind === 'plan_reviewed') {
      latestStatus = item.plan_state === 'approved'
        ? 'using_approved_plan'
        : 'direction_changed';
    }
  }
  return latestStatus;
}

function composerProviderContextDisclosureStatus(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
): BuilderProviderContextDisclosureStatusProjectionWire | null {
  const visibleProjectId = visibleConversationProjectId(projectSnapshot);
  if (
    visibleProjectId === null
    || conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
    || conversationSnapshot.project_id !== visibleProjectId
  ) return null;
  return conversationSnapshot.conversation.provider_context_disclosure_status_projection ?? null;
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
    hasPendingBuildConfirmation: hasPendingBuildConfirmationContext(conversationSnapshot, projectSnapshot),
    hasPriorBuildContext: projectSnapshot.draft !== null
      || (
        hasPriorBuildContext(conversationSnapshot, projectSnapshot)
        && currentWorkingBrief !== null
      ),
    hasWorkspace: hasBuildWorkspace(projectSnapshot),
    hasWritePermission,
  });
}

const DIRECT_CURRENT_DRAFT_BUILD_SIGNALS = new Set([
  'clear_build',
  'contextual_build_phrase',
  'current_artifact_defect',
  'current_artifact_direct_change',
  'current_draft_continuation',
  'vague_change',
]);

function shouldRequestSemanticClassifier(
  decision: BuilderComposerRouteDecision,
  instruction: string,
): boolean {
  if (isBuilderComposerPlanBuildConflictIntent(instruction)) return true;
  return decision.downgradedFrom === 'build'
    || decision.downgradeReason === 'ambiguous_build_intent'
    || decision.downgradeReason === 'missing_prior_build_context';
}

function shouldSkipSemanticClassifierForCurrentDraftBuild(
  decision: BuilderComposerRouteDecision,
  projectSnapshot: BuilderVisibleProjectSnapshot,
  instruction: string,
): boolean {
  return projectSnapshot.draft !== null
    && decision.route === 'build'
    && !isBuilderComposerPlanBuildConflictIntent(instruction)
    && decision.matchedSignals.some((signal) => DIRECT_CURRENT_DRAFT_BUILD_SIGNALS.has(signal));
}

function safeProviderContextDisclosureApproval(
  value: unknown,
): BuilderProviderContextDisclosureApprovalBridge | null {
  if (!isPlainObject(value)) return null;
  const descriptors = ownDataDescriptors(value, PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_KEYS);
  if (descriptors === null || typeof descriptors.approveCurrent.value !== 'function') {
    return null;
  }
  return Object.freeze({
    approveCurrent:
      descriptors.approveCurrent.value as BuilderProviderContextDisclosureApprovalBridge['approveCurrent'],
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

function shouldClearSubmittedIdea(
  snapshot: BuilderVisibleProjectSnapshot,
  activity: BuilderConversationControllerSnapshot | null = null,
): boolean {
  return interruptedTaskContinuation(activity?.conversation ?? null) !== null || snapshot.draft !== null || (
    snapshot.answer !== null
    && snapshot.error === null
  );
}

const PLAN_PROPOSAL_READY_STATUSES = new Set([
  'ready',
  'preview_unavailable',
  'answer_failed',
  'submit_failed',
  'generation_failed',
]);

function liveOutputProjectId(value: BuilderLiveOutputSnapshot | null): string | null {
  return value?.project_id ?? null;
}

function activeRunWaitsForUserAnswer(
  snapshot: BuilderConversationControllerSnapshot,
): boolean {
  const stream = snapshot.conversation;
  if (stream === null || stream.state !== 'ready') return false;
  const activeTurnId = stream.conversation.recorded_active_turn_id;
  if (activeTurnId === null) return false;
  for (let index = stream.conversation.items.length - 1; index >= 0; index -= 1) {
    const item = stream.conversation.items[index];
    if (item.turn_id !== activeTurnId) continue;
    if (
      item.item_kind === 'programming_runtime_tool_activity'
      && item.tool_kind === 'question'
      && item.state === 'running'
    ) return true;
    if (item.item_kind === 'programming_runtime_status') {
      return item.status_kind === 'attention' && item.attention_class === 'user_input_required';
    }
    if (
      item.item_kind === 'programming_runtime_assistant_message'
      || item.item_kind === 'programming_runtime_tool_activity'
    ) return false;
  }
  return false;
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
    if (item.sequence <= afterHeadSequence) continue;
    const matchesProjectQuestion = item.item_kind === 'user_message'
      && item.message_kind === 'submitted'
      && item.mode === 'question'
      && item.message.text.trim() === expectedInstruction;
    const matchesAgentQuestion = item.item_kind === 'transcript_message'
      && item.role === 'user'
      && item.message_kind === 'submitted'
      && item.message.text.trim() === expectedInstruction;
    if (matchesProjectQuestion || matchesAgentQuestion) {
      matchedTurnId = item.turn_id;
      matchedUserSequence = item.sequence;
    }
  }
  if (matchedTurnId === null) return false;
  return items.some((item) => (
    item.sequence > matchedUserSequence
    && item.turn_id === matchedTurnId
    && (
      item.item_kind === 'run_completed'
        ? item.terminal_status === 'succeeded'
          && item.result_kind === 'explanation'
          && item.assistant_message !== null
          && item.assistant_message.text.trim().length > 0
        : item.item_kind === 'transcript_message'
          && item.role === 'assistant'
          && item.message_kind === 'run_result'
          && item.message.text.trim().length > 0
    )
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

function sideWorkspaceFileRefKey(fileRef: BuilderSideWorkspaceFileRef | null): string {
  if (fileRef === null) return 'none';
  return `${fileRef.source_kind}:${fileRef.source_tree_digest}:${fileRef.path}:${fileRef.content_digest}`;
}

function sideWorkspaceFilesRequestKey(
  sourceIdentity: string,
  request: BuilderSideWorkspaceFileRequest,
): string {
  return [
    sourceIdentity,
    request.project_id,
    request.conversation_id,
  ].join(':');
}

function sideWorkspaceSourceIdentity(
  snapshot: BuilderVisibleProjectSnapshot,
): string | null {
  const draft = snapshot.draft;
  if (draft !== null) {
    return `draft:${draft.draft_id}:${draft.source_tree.source_tree_digest}`;
  }
  const savedProject = snapshot.savedProject;
  if (savedProject !== null) {
    return `saved:${savedProject.target.revision_receipt_digest}`;
  }
  return null;
}

function sideWorkspaceFilesRequestKeyFromSnapshots(
  projectSnapshot: BuilderVisibleProjectSnapshot,
  conversationSnapshot: BuilderVisibleConversationSnapshot,
): string | null {
  const sourceIdentity = sideWorkspaceSourceIdentity(projectSnapshot);
  if (
    sourceIdentity === null
    || conversationSnapshot.project_id === null
    || conversationSnapshot.conversation === null
    || conversationSnapshot.conversation.state !== 'ready'
  ) return null;
  return sideWorkspaceFilesRequestKey(sourceIdentity, {
    project_id: conversationSnapshot.project_id,
    conversation_id: conversationSnapshot.conversation.conversation.conversation_id,
  });
}

function firstSideWorkspaceTextFileRef(
  projection: BuilderSideWorkspaceFileTreeProjection,
): BuilderSideWorkspaceFileRef | null {
  return projection.selected_file_ref
    ?? projection.entries.find((entry) => entry.entry_kind === 'text_file')?.file_ref
    ?? null;
}

function sideWorkspaceTextFileRefForPath(
  projection: BuilderSideWorkspaceFileTreeProjection,
  path: BuilderFileName | null,
): BuilderSideWorkspaceFileRef | null {
  if (path === null) return null;
  const entry = projection.entries.find((candidate) => (
    candidate.entry_kind === 'text_file' && candidate.path === path
  ));
  return entry?.entry_kind === 'text_file' ? entry.file_ref : null;
}

type BuilderTaskTranscriptDownload = Readonly<{
  filename: string;
  mediaType: string;
  taskAddressId: string;
  text: string;
}>;

const BUILDER_TASK_TRANSCRIPT_EXPORT_VERSION = 'builder-task-transcript-export.v1';
const TASK_TRANSCRIPT_EXPORT_FEEDBACK_CLEAR_MS = 4000;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeDownloadSegment(value: string, fallback: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return segment.length === 0 ? fallback : segment;
}

function taskTranscriptDownloadFromExport(value: unknown): BuilderTaskTranscriptDownload | null {
  const exportRecord = objectRecord(value);
  if (exportRecord === null || exportRecord.export_version !== BUILDER_TASK_TRANSCRIPT_EXPORT_VERSION) {
    return null;
  }
  const formats = objectRecord(exportRecord.formats);
  const markdown = objectRecord(formats?.markdown);
  const task = objectRecord(exportRecord.task);
  const text = markdown?.text;
  const mediaType = markdown?.media_type;
  const taskAddressId = exportRecord.task_address_id;
  const exportedAtMs = exportRecord.exported_at_ms;
  const title = task?.title;
  const exportedAtNumber = typeof exportedAtMs === 'number' && Number.isSafeInteger(exportedAtMs)
    ? exportedAtMs
    : null;
  if (
    typeof text !== 'string'
    || text.length === 0
    || typeof mediaType !== 'string'
    || !mediaType.startsWith('text/markdown')
    || typeof taskAddressId !== 'string'
    || exportedAtNumber === null
  ) return null;
  const titleSegment = safeDownloadSegment(typeof title === 'string' ? title : '', 'task');
  const timeSegment = new Date(exportedAtNumber).toISOString().replace(/[:.]/gu, '-');
  return {
    filename: `clawfabric-${titleSegment}-transcript-${timeSegment}.md`,
    mediaType,
    taskAddressId,
    text,
  };
}

function downloadTaskTranscript(download: BuilderTaskTranscriptDownload): void {
  const url = URL.createObjectURL(new Blob([download.text], { type: download.mediaType }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = download.filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BuilderApp({ bridgeRoot }: BuilderAppProps) {
  useLayoutEffect(() => {
    incrementBuilderPerformance('renderer.builder_app.commit_count');
  });
  const root = useMemo(() => safeRoot(bridgeRoot), [bridgeRoot]);
  const ports = useMemo(() => safePorts(root), [root]);
  const windowControls = useMemo(() => safeWindowControls(root.windowControls), [root]);
  const providerContextDisclosureApproval = useMemo(
    () => safeProviderContextDisclosureApproval(root.providerContextDisclosureApproval),
    [root],
  );
  const catalog = useBuilderProjectCatalogController(ports.workspace);
  const agentProjectTree = useBuilderAgentProjectTreeController(ports.agentProjectTree);
  const agentWorkbench = useBuilderAgentWorkbenchController(ports.agentWorkbench);
  const [view, setView] = useState<BuilderAppView>('project');
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [projectId, setProjectId] = useState<string | undefined>();
  const [agentWorkbenchSelected, setAgentWorkbenchSelected] = useState(true);
  const [taskAddressId, setTaskAddressId] = useState<string | null>(null);
  const [retainedTaskConversationSeed, setRetainedTaskConversationSeed] =
    useState<BuilderTaskConversationSeed | null>(null);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [idea, setIdea] = useState('');
  const [activeFile, setActiveFile] = useState<BuilderFileName | null>(null);
  const [composerMode, setComposerMode] = useState<BuilderComposerMode | null>(null);
  const [approvalMode, setApprovalMode] = useState<BuilderComposerApprovalMode>('ask_before_write');
  const [submitInFlight, setSubmitInFlight] = useState(false);
  const [agentSubmitInFlight, setAgentSubmitInFlight] = useState(false);
  const [composerRouteDecision, setComposerRouteDecision] =
    useState<BuilderComposerRouteDecisionEvidence | null>(null);
  const [lockedComposerSubmit, setLockedComposerSubmit] =
    useState<LockedComposerSubmit | null>(null);
  const [queuedActiveRunFollowup, setQueuedActiveRunFollowup] =
    useState<QueuedActiveRunFollowup | null>(null);
  const [pendingUserMessages, setPendingUserMessages] =
    useState<readonly PendingUserMessage[]>([]);
  const liveOutputStore = useMemo(() => createBuilderLiveOutputStore(), []);
  const agentLiveOutputStore = useMemo(() => createBuilderLiveOutputStore(), []);
  const commandOutputStore = useMemo(() => createBuilderCommandOutputStore(), []);
  const [liveOutput, setLiveOutput] = useState<BuilderLiveOutputSnapshot | null>(null);
  const [agentLiveOutput, setAgentLiveOutput] = useState<BuilderLiveOutputSnapshot | null>(null);
  const [answerFailureRecordedSuccess, setAnswerFailureRecordedSuccess] = useState(false);
  const [taskTranscriptExportFeedback, setTaskTranscriptExportFeedback] =
    useState<BuilderTaskTranscriptExportFeedback | null>(null);
  const [manualContextCompactionFeedback, setManualContextCompactionFeedback] =
    useState<BuilderManualContextCompactionFeedback>('idle');
  const [planReviewFailure, setPlanReviewFailure] = useState<BuilderPlanReviewInFlight | null>(null);
  const [planReviewInFlight, setPlanReviewInFlight] = useState<BuilderPlanReviewInFlight | null>(null);
  const [planReviewRecorded, setPlanReviewRecorded] = useState<BuilderPlanReviewInFlight | null>(null);
  const [approvedPlanContinuationFailure, setApprovedPlanContinuationFailure] =
    useState<BuilderPlanReviewInFlight | null>(null);
  const [catalogNewProjectPending, setCatalogNewProjectPending] = useState(false);
  const [planSourceReadApproval, setPlanSourceReadApproval] =
    useState<BuilderPlanSourceReadApprovalPrompt | null>(null);
  const [currentProjectWriteApproval, setCurrentProjectWriteApproval] =
    useState<BuilderCurrentProjectWriteApprovalPrompt | null>(null);
  const [commandApproval, setCommandApproval] = useState<BuilderCommandApprovalPrompt | null>(null);
  const [currentProjectWriteApprovalStatus, setCurrentProjectWriteApprovalStatus] =
    useState<Readonly<{ project_id: string; state: BuilderCurrentProjectWriteApprovalStatus['state'] }> | null>(null);
  const [providerContextDisclosureApprovalState, setProviderContextDisclosureApprovalState] =
    useState<'idle' | 'approving' | 'failed'>('idle');
  const [providerSettingsCurrent, setProviderSettingsCurrent] =
    useState<BuilderProviderSettingsCurrent | null>(null);
  const [providerSettingsState, setProviderSettingsState] =
    useState<BuilderComposerModelSelection['status']>('loading');
  const providerSettingsRefreshSerialRef = useRef(0);
  const [livePreviewStatus, setLivePreviewStatus] =
    useState<BuilderLivePreviewStatusProjection | null>(null);
  const [livePreviewOperation, setLivePreviewOperation] =
    useState<'starting' | 'reloading' | 'stopping' | null>(null);
  const livePreviewResponseVersion = useRef(0);
  const [userWebStatus, setUserWebStatus] =
    useState<BuilderUserWebStatusProjection | null>(null);
  const [userWebOperation, setUserWebOperation] =
    useState<'navigating' | 'reloading' | 'stopping' | null>(null);
  const [sideWorkspaceFileTreeKey, setSideWorkspaceFileTreeKey] = useState<string | null>(null);
  const [sideWorkspaceFileTree, setSideWorkspaceFileTree] =
    useState<BuilderSideWorkspaceFileTreeProjection | null>(null);
  const [sideWorkspaceFileTreeStatus, setSideWorkspaceFileTreeStatus] =
    useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [sideWorkspaceFileContentKey, setSideWorkspaceFileContentKey] = useState<string | null>(null);
  const [sideWorkspaceFileContent, setSideWorkspaceFileContent] =
    useState<BuilderSideWorkspaceFileContentProjection | null>(null);
  const [sideWorkspaceFileContentStatus, setSideWorkspaceFileContentStatus] =
    useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [sideWorkspaceSelectedFileRef, setSideWorkspaceSelectedFileRef] =
    useState<BuilderSideWorkspaceFileRef | null>(null);
  const [checkRunAvailable, setCheckRunAvailable] =
    useState<BuilderCheckRunAvailableResult | null>(null);
  const [checkEnvironmentDiagnosis, setCheckEnvironmentDiagnosis] =
    useState<BuilderCheckEnvironmentDiagnosisView | null>(null);
  const [projectEnvironmentDiagnosis, setProjectEnvironmentDiagnosis] =
    useState<BuilderProjectEnvironmentDiagnosisView | null>(null);
  const [projectDependencyPreparation, setProjectDependencyPreparation] =
    useState<Readonly<{
      project_id: string;
      status: 'preparing' | 'failed';
      failure_message?: string;
    }> | null>(null);
  const [checkRunOperation, setCheckRunOperation] =
    useState<'loading' | 'running' | 'preparing_dependencies' | 'skipping' | 'failed' | null>(null);
  const [checkRunOperationFailureCode, setCheckRunOperationFailureCode] =
    useState<BuilderCheckRunOperationFailureCode | null>(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const projectCount = agentProjectTree.snapshot.tree?.projects.length ?? 0;
  const hasProjects = projectCount > 0;
  const projectsExpanded = hasProjects && !projectsCollapsed;
  const projectsVisibility = projectsExpanded
    ? 'expanded'
    : (hasProjects ? 'collapsed' : 'absent');
  const previousProjectCountRef = useRef(projectCount);
  const workspaceEpochRef = useRef(0);
  const activeFileRef = useRef<BuilderFileName | null>(null);
  const taskTranscriptExportSerialRef = useRef(0);
  const taskTranscriptExportFeedbackTimerRef = useRef<number | null>(null);
  const initialWorkspaceAutoOpenRef = useRef(false);
  const windowMaximizedRef = useRef(false);
  const liveOutputRef = useRef<BuilderLiveOutputSnapshot | null>(null);
  const composerModeRef = useRef<BuilderComposerMode | null>(null);
  const approvalModeRef = useRef<BuilderComposerApprovalMode>('ask_before_write');
  const composerRouteDecisionSequenceRef = useRef(0);
  const planReviewInFlightRef = useRef<BuilderPlanReviewInFlight | null>(null);
  const planSourceReadApprovalRef = useRef<BuilderPlanSourceReadApprovalPrompt | null>(null);
  const currentProjectWriteApprovalRef = useRef<BuilderCurrentProjectWriteApprovalPrompt | null>(null);
  const commandApprovalRef = useRef<BuilderCommandApprovalPrompt | null>(null);
  const currentProjectWriteApprovalStatusRef =
    useRef<Readonly<{ project_id: string; state: BuilderCurrentProjectWriteApprovalStatus['state'] }> | null>(null);
  const dependencyPreparationInFlightRef = useRef<string | null>(null);
  const pendingAgentTaskHandoffStartRef = useRef<PendingAgentTaskHandoffStart | null>(null);
  const agentTaskProposalProjectCreationInFlightRef = useRef(new Set<string>());

  useEffect(() => {
    const previousProjectCount = previousProjectCountRef.current;
    previousProjectCountRef.current = projectCount;
    if (previousProjectCount === 0 && projectCount > 0) setProjectsCollapsed(false);
  }, [projectCount]);
  useEffect(() => () => {
    if (taskTranscriptExportFeedbackTimerRef.current !== null) {
      window.clearTimeout(taskTranscriptExportFeedbackTimerRef.current);
    }
  }, []);
  const queuedActiveRunFollowupRef = useRef<QueuedActiveRunFollowup | null>(null);
  const submitInstructionTextRef = useRef<SubmitInstructionText | null>(null);
  const restoreAttemptCountsRef = useRef(new Map<string, number>());
  const restoreAttemptsInFlightRef = useRef(new Set<string>());
  const activityRestoreLoadAttemptsRef = useRef(new Map<string, number>());
  const activityRestoreLoadsInFlightRef = useRef(new Set<string>());
  const activityRestoreProbeKeysRef = useRef(new Set<string>());
  const lifecycleRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const lifecycleRefreshQueuedRef = useRef(false);
  const lifecycleRefreshNeedsWorkbenchRef = useRef(false);
  const automaticDraftRestoreSuppressedProjectIdsRef = useRef(new Set<string>());
  const pendingProjectActivityRestoreRef = useRef<Readonly<{ epoch: number; projectId: string }> | null>(null);
  const restorePendingDraftFromActivityRef =
    useRef<((visibleProjectId: string, commandEpoch: number) => void) | null>(null);
  const workbenchDraftReturnRef = useRef<WorkbenchDraftReturnTarget | null>(null);
  const submitInFlightRef = useRef(false);
  const submitInFlightInstructionRef = useRef<string | null>(null);
  const agentRequestIdRef = useRef<string | null>(null);
  const agentSubmitInFlightRef = useRef(false);
  const agentComposerModeRef = useRef<BuilderComposerMode | null>(null);
  const agentWorkbenchSelectedRef = useRef(agentWorkbenchSelected);
  const lockedComposerSubmitRef = useRef<LockedComposerSubmit | null>(null);
  const checkRunRequestSequenceRef = useRef(0);
  const pendingUserMessageSequenceRef = useRef(0);
  const sideWorkspaceFileTreeSequenceRef = useRef(0);
  const sideWorkspaceFileContentSequenceRef = useRef(0);
  const sideWorkspaceFileContentMountedRef = useRef(false);
  const sideWorkspaceFileTreeKeyRef = useRef<string | null>(null);
  const sideWorkspaceFileContentKeyRef = useRef<string | null>(null);
  const projectEnvironmentAutoDiagnosisKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const refreshSerial = providerSettingsRefreshSerialRef.current + 1;
    providerSettingsRefreshSerialRef.current = refreshSerial;
    ports.providerSettings.readCurrent()
      .then((current) => {
        if (!active || providerSettingsRefreshSerialRef.current !== refreshSerial) return;
        setProviderSettingsCurrent(current);
        setProviderSettingsState(current.configured ? 'ready' : 'unconfigured');
      })
      .catch(() => {
        if (!active || providerSettingsRefreshSerialRef.current !== refreshSerial) return;
        setProviderSettingsCurrent(null);
        setProviderSettingsState('unavailable');
      });
    return () => {
      active = false;
    };
  }, [ports.providerSettings, view]);
  const publishSubmitInFlight = useCallback((inFlight: boolean) => {
    submitInFlightRef.current = inFlight;
    setSubmitInFlight(inFlight);
  }, []);
  const publishLockedComposerSubmit = useCallback((lockedSubmit: LockedComposerSubmit | null) => {
    lockedComposerSubmitRef.current = lockedSubmit;
    setLockedComposerSubmit(lockedSubmit);
  }, []);
  const publishQueuedActiveRunFollowup = useCallback((queued: QueuedActiveRunFollowup | null) => {
    queuedActiveRunFollowupRef.current = queued;
    setQueuedActiveRunFollowup(queued);
  }, []);
  const publishPendingUserMessage = useCallback((
    text: string,
    messageKind: BuilderPendingUserMessage['message_kind'],
    identity: Readonly<{ message_id?: string | null; turn_id?: string | null }> = {},
  ) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    const sequence = pendingUserMessageSequenceRef.current + 1;
    pendingUserMessageSequenceRef.current = sequence;
    const message = Object.freeze({
      client_id: `builder-pending-user-message:${sequence}`,
      epoch: workspaceEpochRef.current,
      message_id: identity.message_id ?? null,
      minimum_sequence: conversationHeadSequence(conversationSnapshotRef.current),
      projectId: visibleConversationProjectId(projectSnapshotRef.current)
        ?? conversationSnapshotRef.current.project_id
        ?? null,
      taskAddressId,
      text: trimmed,
      message_kind: messageKind,
      turn_id: identity.turn_id ?? null,
    });
    setPendingUserMessages((current) => Object.freeze([...current, message]));
    return message;
  }, [taskAddressId]);
  const bindPendingUserMessage = useCallback((
    clientId: string | null,
    identity: Readonly<{ message_id?: string | null; turn_id?: string | null }>,
  ) => {
    if (clientId === null) return;
    setPendingUserMessages((current) => {
      let changed = false;
      const next = current.map((message) => {
        if (message.client_id !== clientId) return message;
        const messageId = identity.message_id ?? message.message_id ?? null;
        const turnId = identity.turn_id ?? message.turn_id ?? null;
        if (message.message_id === messageId && message.turn_id === turnId) return message;
        changed = true;
        return Object.freeze({
          ...message,
          message_id: messageId,
          turn_id: turnId,
        });
      });
      return changed ? Object.freeze(next) : current;
    });
  }, []);
  const dismissPendingUserMessage = useCallback((clientId: string | null) => {
    if (clientId === null) return;
    setPendingUserMessages((current) => {
      const next = current.filter((message) => message.client_id !== clientId);
      return next.length === current.length ? current : Object.freeze(next);
    });
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
      resumeInterruptedRun(
        request: Parameters<NonNullable<BuilderCodeGeneratorPort['resumeInterruptedRun']>>[0],
      ) {
        return ports.generator.resumeInterruptedRun?.(request)
          ?? Promise.reject(new BuilderDesktopCodeGeneratorPortError());
      },
      ...(ports.generator.manualCompactContext === undefined ? {} : {
        manualCompactContext(
          request: Parameters<NonNullable<BuilderCodeGeneratorPort['manualCompactContext']>>[0],
        ) {
          return ports.generator.manualCompactContext!(request);
        },
      }),
      answer(request: Parameters<BuilderCodeGeneratorPort['answer']>[0]) {
        return ports.generator.answer(request);
      },
      answerPlan(request: Parameters<NonNullable<BuilderCodeGeneratorPort['answerPlan']>>[0]) {
        return ports.generator.answerPlan?.(request) ?? ports.generator.answer(request);
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
      restorePreviousCheckpointAsDraft(
        request: Parameters<NonNullable<BuilderCodeGeneratorPort['restorePreviousCheckpointAsDraft']>>[0],
      ) {
        return ports.generator.restorePreviousCheckpointAsDraft?.(request)
          ?? Promise.reject(new BuilderDesktopCodeGeneratorPortError());
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
      queueFollowup(request: Parameters<BuilderCodeGeneratorPort['queueFollowup']>[0]) {
        return ports.generator.queueFollowup(request);
      },
      subscribeStarted(listener: (event: BuilderGenerationStartedEvent) => void) {
        return ports.generator.subscribeStarted?.(listener) ?? (() => undefined);
      },
      subscribeOutput(listener: (event: BuilderGenerationOutputEvent) => void) {
        return ports.generator.subscribeOutput?.(listener) ?? (() => undefined);
      },
      ...(ports.generator.decideCommandApproval === undefined ? {} : {
        decideCommandApproval(
          request: Parameters<NonNullable<BuilderCodeGeneratorPort['decideCommandApproval']>>[0],
        ) {
          return ports.generator.decideCommandApproval!(request);
        },
      }),
      ...(ports.generator.subscribeCommandApproval === undefined ? {} : {
        subscribeCommandApproval(listener: (event: BuilderCommandApprovalRequest) => void) {
          return ports.generator.subscribeCommandApproval!(listener);
        },
      }),
      ...(ports.generator.subscribeCommandOutput === undefined ? {} : {
        subscribeCommandOutput(
          listener: Parameters<NonNullable<BuilderCodeGeneratorPort['subscribeCommandOutput']>>[0],
        ) {
          return ports.generator.subscribeCommandOutput!(listener);
        },
      }),
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
    preserveSelectionWhenProjectIdUndefined: agentWorkbenchSelected,
    projectId,
    taskAddressId,
  });
  // Agent runs outlive project selection; this controller never opens a project workspace.
  const agentConversation = useBuilderProjectController({
    generator: ports.generator,
    workspace: ports.workspace,
    conversationScope: 'agent',
    preserveSelectionWhenProjectIdUndefined: true,
  });
  const activeConversation = agentWorkbenchSelected ? agentConversation : project;
  const conversation = useBuilderConversationController(
    ports.taskStream,
    agentWorkbenchSelected ? null : visibleConversationProjectId(project.snapshot),
    taskAddressId,
    agentProjectTree.snapshot.tree?.agent_id ?? null,
  );
  const liveSelectedTask = useMemo(() => taskConversationSeed(taskForAddress(
    agentProjectTree.snapshot.tree,
    agentWorkbenchSelected ? null : taskAddressId,
  )), [agentProjectTree.snapshot.tree, agentWorkbenchSelected, taskAddressId]);
  const monitoredSelectedTask = useMemo(() => taskConversationSeed(
    agentWorkbenchSelected
      ? null
      : (agentWorkbench.snapshot.projection?.task_monitor.tasks.find(
          (task) => task.task_address_id === taskAddressId,
        ) ?? null),
  ), [agentWorkbench.snapshot.projection, agentWorkbenchSelected, taskAddressId]);
  const retainedSelectedTask = (
    !agentWorkbenchSelected
    && taskAddressId !== null
    && retainedTaskConversationSeed !== null
    && retainedTaskConversationSeed.task_address_id === taskAddressId
      ? retainedTaskConversationSeed
      : null
  );
  const selectedTask = liveSelectedTask ?? monitoredSelectedTask ?? retainedSelectedTask;
  const history = useBuilderProjectHistoryController(
    ports.workspace,
    visibleHistoryProjectId(project.snapshot),
  );
  const composerContextStatus = composerWorkingContextStatus(conversation.snapshot, project.snapshot);
  const projectSnapshotRef = useRef(activeConversation.snapshot);
  const conversationSnapshotRef = useRef(conversation.snapshot);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- The callback ref must observe the latest active snapshot.
    projectSnapshotRef.current = activeConversation.snapshot;
    agentWorkbenchSelectedRef.current = agentWorkbenchSelected;
  }, [activeConversation.snapshot, agentWorkbenchSelected]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- Async controller callbacks read the latest durable snapshot.
    conversationSnapshotRef.current = conversation.snapshot;
  }, [conversation.snapshot]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Selection changes clear only contextual feedback.
    setManualContextCompactionFeedback('idle');
  }, [agentWorkbenchSelected, projectId, taskAddressId]);

  useEffect(() => {
    if (pendingUserMessages.length === 0) return;
    const snapshot = conversation.snapshot;
    if (snapshot.conversation?.state !== 'ready') return;
    const durableMessages = snapshot.conversation.conversation.items
      .map(builderDurableUserMessage)
      .filter((message) => message !== null);
    setPendingUserMessages((current) => {
      const next = current.filter((message) => (
        message.epoch === workspaceEpochRef.current
        && message.projectId === (snapshot.project_id ?? null)
        && message.taskAddressId === snapshot.task_address_id
        && !durableMessages.some((durable) => (
          builderPendingUserMessageMatchesDurable(message, durable)
        ))
      ));
      return next.length === current.length ? current : Object.freeze(next);
    });
  }, [conversation.snapshot, pendingUserMessages.length]);

  useEffect(() => {
    if (pendingUserMessages.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Workspace identity changes synchronously evict stale optimistic messages.
    setPendingUserMessages((current) => (
      current.length === 0
        ? current
        : Object.freeze(current.filter((message) => (
          message.epoch === workspaceEpoch
          && message.projectId === (projectId ?? conversation.snapshot.project_id ?? null)
          && message.taskAddressId === taskAddressId
        )))
    ));
  }, [conversation.snapshot.project_id, pendingUserMessages.length, projectId, taskAddressId, workspaceEpoch]);

  useLayoutEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  const currentDraftId = project.snapshot.draft?.draft_id ?? null;
  const currentSideWorkspaceSourceIdentity = sideWorkspaceSourceIdentity(project.snapshot);
  const currentSideWorkspaceFilesRequestKey = useMemo(() => {
    return sideWorkspaceFilesRequestKeyFromSnapshots(project.snapshot, conversation.snapshot);
  }, [conversation.snapshot, project.snapshot]);

  const sideWorkspaceFilesRequest = useCallback((): BuilderSideWorkspaceFileRequest | null => {
    const conversationSnapshot = conversationSnapshotRef.current;
    if (
      sideWorkspaceSourceIdentity(projectSnapshotRef.current) === null
      || conversationSnapshot.project_id === null
      || conversationSnapshot.conversation === null
      || conversationSnapshot.conversation.state !== 'ready'
    ) return null;
    return Object.freeze({
      project_id: conversationSnapshot.project_id,
      conversation_id: conversationSnapshot.conversation.conversation.conversation_id,
    });
  }, []);

  const conversationFilesRequest = useCallback((): BuilderSideWorkspaceFileRequest | null => {
    const conversationSnapshot = conversationSnapshotRef.current;
    if (
      conversationSnapshot.project_id === null
      || conversationSnapshot.conversation === null
      || conversationSnapshot.conversation.state !== 'ready'
    ) return null;
    return Object.freeze({
      project_id: conversationSnapshot.project_id,
      conversation_id: conversationSnapshot.conversation.conversation.conversation_id,
    });
  }, []);

  const requestSideWorkspaceFiles = useCallback(async () => {
    const request = sideWorkspaceFilesRequest();
    if (request === null || currentSideWorkspaceSourceIdentity === null) return;
    const requestKey = sideWorkspaceFilesRequestKey(
      currentSideWorkspaceSourceIdentity,
      request,
    );
    const currentRequestStillMatches = () => (
      requestKey === sideWorkspaceFilesRequestKeyFromSnapshots(
        projectSnapshotRef.current,
        conversationSnapshotRef.current,
      )
    );
    if (
      sideWorkspaceFileTreeKeyRef.current === requestKey
      && (sideWorkspaceFileTreeStatus === 'loading' || sideWorkspaceFileTreeStatus === 'ready')
    ) return;
    sideWorkspaceFileTreeKeyRef.current = requestKey;
    const sequence = sideWorkspaceFileTreeSequenceRef.current + 1;
    sideWorkspaceFileTreeSequenceRef.current = sequence;
    sideWorkspaceFileContentSequenceRef.current += 1;
    setSideWorkspaceFileTreeKey(requestKey);
    setSideWorkspaceFileTreeStatus('loading');
    setSideWorkspaceFileTree(null);
    sideWorkspaceFileContentKeyRef.current = null;
    setSideWorkspaceFileContentKey(null);
    setSideWorkspaceFileContent(null);
    setSideWorkspaceFileContentStatus('idle');
    setSideWorkspaceSelectedFileRef(null);
    const releaseStaleRequest = () => {
      if (sideWorkspaceFileTreeSequenceRef.current !== sequence) return;
      sideWorkspaceFileTreeKeyRef.current = null;
      setSideWorkspaceFileTreeKey(null);
      setSideWorkspaceFileTree(null);
      setSideWorkspaceFileTreeStatus('idle');
      sideWorkspaceFileContentKeyRef.current = null;
      setSideWorkspaceFileContentKey(null);
      setSideWorkspaceFileContent(null);
      setSideWorkspaceFileContentStatus('idle');
      setSideWorkspaceSelectedFileRef(null);
    };
    for (let attempt = 1; attempt <= SIDE_WORKSPACE_FILE_DISCOVERY_MAX_ATTEMPTS; attempt += 1) {
      try {
        const projection = await ports.sideWorkspaceFiles.readCurrentDraftFileTree(request);
        if (sideWorkspaceFileTreeSequenceRef.current !== sequence) return;
        if (!currentRequestStillMatches()) {
          releaseStaleRequest();
          return;
        }
        setSideWorkspaceFileTree(projection);
        setSideWorkspaceFileTreeStatus('ready');
        setSideWorkspaceSelectedFileRef(
          sideWorkspaceTextFileRefForPath(projection, activeFileRef.current)
            ?? firstSideWorkspaceTextFileRef(projection),
        );
        return;
      } catch {
        if (sideWorkspaceFileTreeSequenceRef.current !== sequence) return;
        if (!currentRequestStillMatches()) {
          releaseStaleRequest();
          return;
        }
        if (attempt < SIDE_WORKSPACE_FILE_DISCOVERY_MAX_ATTEMPTS) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, SIDE_WORKSPACE_FILE_DISCOVERY_RETRY_DELAY_MS);
          });
          continue;
        }
        setSideWorkspaceFileTreeKey(requestKey);
        setSideWorkspaceFileTree(null);
        setSideWorkspaceFileTreeStatus('failed');
        sideWorkspaceFileContentKeyRef.current = null;
        setSideWorkspaceFileContentKey(null);
        setSideWorkspaceFileContent(null);
        setSideWorkspaceFileContentStatus('failed');
        setSideWorkspaceSelectedFileRef(null);
      }
    }
  }, [
    currentSideWorkspaceSourceIdentity,
    ports.sideWorkspaceFiles,
    sideWorkspaceFileTreeStatus,
    sideWorkspaceFilesRequest,
  ]);

  const selectSideWorkspaceFile = useCallback((fileRef: BuilderSideWorkspaceFileRef) => {
    setActiveFile(fileRef.path);
    setSideWorkspaceSelectedFileRef(fileRef);
  }, []);

  const selectActiveFile = useCallback((path: BuilderFileName) => {
    setActiveFile(path);
    if (sideWorkspaceFileTree === null) return;
    const fileRef = sideWorkspaceTextFileRefForPath(sideWorkspaceFileTree, path);
    if (fileRef !== null) setSideWorkspaceSelectedFileRef(fileRef);
  }, [sideWorkspaceFileTree]);

  const openRuntimeToolFile = useCallback(async (
    request: Readonly<{ run_id: string; tool_call_id: string }>,
  ): Promise<boolean> => {
    const conversationRequest = conversationFilesRequest();
    if (conversationRequest === null) return false;
    const sequence = sideWorkspaceFileTreeSequenceRef.current + 1;
    sideWorkspaceFileTreeSequenceRef.current = sequence;
    sideWorkspaceFileContentSequenceRef.current += 1;
    setSideWorkspaceFileTreeStatus('loading');
    try {
      const projection = await ports.sideWorkspaceFiles.readRuntimeToolFileTree({
        ...conversationRequest,
        run_id: request.run_id,
        tool_call_id: request.tool_call_id,
      });
      if (sideWorkspaceFileTreeSequenceRef.current !== sequence) return false;
      const selectedFileRef = projection.selected_file_ref;
      if (selectedFileRef === null) return false;
      const content = await ports.sideWorkspaceFiles.readCurrentDraftFileContent({
        ...conversationRequest,
        file_ref: selectedFileRef,
      });
      if (
        sideWorkspaceFileTreeSequenceRef.current !== sequence
        || sideWorkspaceFileRefKey(content.file_ref) !== sideWorkspaceFileRefKey(selectedFileRef)
      ) return false;
      const requestKey = [
        'runtime',
        conversationRequest.project_id,
        conversationRequest.conversation_id,
        projection.source_tree_digest,
      ].join(':');
      const contentKey = `${conversationRequest.project_id}:${conversationRequest.conversation_id}:${sideWorkspaceFileRefKey(selectedFileRef)}`;
      sideWorkspaceFileTreeKeyRef.current = requestKey;
      sideWorkspaceFileContentKeyRef.current = contentKey;
      setSideWorkspaceFileTreeKey(requestKey);
      setSideWorkspaceFileTree(projection);
      setSideWorkspaceFileTreeStatus('ready');
      setSideWorkspaceSelectedFileRef(selectedFileRef);
      setActiveFile(selectedFileRef.path);
      setSideWorkspaceFileContentKey(contentKey);
      setSideWorkspaceFileContent(content);
      setSideWorkspaceFileContentStatus('ready');
      return true;
    } catch {
      if (sideWorkspaceFileTreeSequenceRef.current === sequence) {
        sideWorkspaceFileContentKeyRef.current = null;
        setSideWorkspaceFileContentKey(null);
        setSideWorkspaceFileContent(null);
        setSideWorkspaceFileTreeStatus('failed');
        setSideWorkspaceFileContentStatus('failed');
      }
      return false;
    }
  }, [conversationFilesRequest, ports.sideWorkspaceFiles]);

  useEffect(() => {
    sideWorkspaceFileContentMountedRef.current = true;
    return () => {
      sideWorkspaceFileContentMountedRef.current = false;
      sideWorkspaceFileContentSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const loadFileContent = async () => {
      await Promise.resolve();
      if (!sideWorkspaceFileContentMountedRef.current) return;
      const request = conversationFilesRequest();
      const fileRef = sideWorkspaceSelectedFileRef;
      if (
        request === null
        || fileRef === null
        || sideWorkspaceFileTree === null
      ) {
        sideWorkspaceFileContentSequenceRef.current += 1;
        sideWorkspaceFileContentKeyRef.current = null;
        setSideWorkspaceFileContentKey(null);
        setSideWorkspaceFileContent(null);
        setSideWorkspaceFileContentStatus('idle');
        return;
      }
      const contentKey = `${request.project_id}:${request.conversation_id}:${sideWorkspaceFileRefKey(fileRef)}`;
      if (
        fileRef.source_tree_digest !== sideWorkspaceFileTree.source_tree_digest
      ) {
        sideWorkspaceFileContentSequenceRef.current += 1;
        sideWorkspaceFileContentKeyRef.current = contentKey;
        setSideWorkspaceFileContentKey(contentKey);
        setSideWorkspaceFileContent(null);
        setSideWorkspaceFileContentStatus('failed');
        return;
      }
      if (sideWorkspaceFileContentKeyRef.current === contentKey) return;
      const sequence = sideWorkspaceFileContentSequenceRef.current + 1;
      sideWorkspaceFileContentSequenceRef.current = sequence;
      sideWorkspaceFileContentKeyRef.current = contentKey;
      setSideWorkspaceFileContentKey(contentKey);
      setSideWorkspaceFileContentStatus('loading');
      setSideWorkspaceFileContent(null);
      try {
        const projection = await ports.sideWorkspaceFiles.readCurrentDraftFileContent({
          ...request,
          file_ref: fileRef,
        });
        if (
          !sideWorkspaceFileContentMountedRef.current
          || sideWorkspaceFileContentSequenceRef.current !== sequence
          || sideWorkspaceFileRefKey(projection.file_ref) !== sideWorkspaceFileRefKey(fileRef)
        ) return;
        setSideWorkspaceFileContent(projection);
        setSideWorkspaceFileContentStatus('ready');
      } catch {
        if (
          !sideWorkspaceFileContentMountedRef.current
          || sideWorkspaceFileContentSequenceRef.current !== sequence
        ) return;
        setSideWorkspaceFileContent(null);
        setSideWorkspaceFileContentStatus('failed');
      }
    };
    void loadFileContent();
  }, [
    ports.sideWorkspaceFiles,
    conversationFilesRequest,
    sideWorkspaceFileTree,
    sideWorkspaceSelectedFileRef,
  ]);

  useEffect(() => {
    const requestSequence = checkRunRequestSequenceRef.current + 1;
    checkRunRequestSequenceRef.current = requestSequence;
    let active = true;
    const loadAvailableChecks = async () => {
      await Promise.resolve();
      if (!active || checkRunRequestSequenceRef.current !== requestSequence) return;
      setCheckRunAvailable(null);
      setCheckEnvironmentDiagnosis(null);
      if (currentDraftId === null) {
        setCheckRunOperation(null);
        setCheckRunOperationFailureCode(null);
        return;
      }
      setCheckRunOperation('loading');
      setCheckRunOperationFailureCode(null);
      for (let attempt = 1; attempt <= CHECK_RUN_DISCOVERY_MAX_ATTEMPTS; attempt += 1) {
        try {
          const result = await ports.checkRun.readCurrentDraftAvailableChecks({ draft_id: currentDraftId });
          if (!active
            || checkRunRequestSequenceRef.current !== requestSequence
            || projectSnapshotRef.current.draft?.draft_id !== currentDraftId) return;
          setCheckRunAvailable(result);
          setCheckRunOperation(null);
          setCheckRunOperationFailureCode(null);
          return;
        } catch (error) {
          if (!active
            || checkRunRequestSequenceRef.current !== requestSequence
            || projectSnapshotRef.current.draft?.draft_id !== currentDraftId) return;
          if (attempt === CHECK_RUN_DISCOVERY_MAX_ATTEMPTS) {
            setCheckRunOperation('failed');
            setCheckRunOperationFailureCode(classifyCheckRunOperationFailureCode(error));
            return;
          }
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, CHECK_RUN_DISCOVERY_RETRY_DELAY_MS);
          });
        }
      }
    };
    void loadAvailableChecks();
    return () => {
      active = false;
    };
  }, [currentDraftId, ports.checkRun]);

  useEffect(() => {
    projectEnvironmentAutoDiagnosisKeyRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Project selection changes evict selected-project-scoped readiness state.
    setProjectEnvironmentDiagnosis(null);
    setProjectDependencyPreparation(null);
  }, [projectId]);

  const decideCheckDependencyPreparation = useCallback(async (
    decision: BuilderCheckRunDependencyPreparationDecision,
    profile: BuilderCheckRunProfile,
  ) => {
    const draftId = currentDraftId;
    if (draftId === null) return;
    if (dependencyPreparationInFlightRef.current === draftId) return;
    dependencyPreparationInFlightRef.current = draftId;
    setCheckRunOperation('preparing_dependencies');
    setCheckRunOperationFailureCode(null);
    try {
      await ports.checkRun.decideCurrentDraftDependencyPreparation({
        draft_id: draftId,
        command_profile_id: profile.command_profile_id,
        decision,
      });
      if (projectSnapshotRef.current.draft?.draft_id === draftId) {
        await conversation.refresh();
        if (projectSnapshotRef.current.draft?.draft_id === draftId) {
          setCheckEnvironmentDiagnosis((current) => (
            current?.command_profile_id === profile.command_profile_id ? null : current
          ));
          setCheckRunOperation(null);
          setCheckRunOperationFailureCode(null);
        }
      }
    } catch (error) {
      if (projectSnapshotRef.current.draft?.draft_id === draftId) {
        setCheckRunOperation('failed');
        setCheckRunOperationFailureCode(classifyCheckRunOperationFailureCode(error));
      }
    } finally {
      if (dependencyPreparationInFlightRef.current === draftId) {
        dependencyPreparationInFlightRef.current = null;
      }
    }
  }, [conversation, currentDraftId, ports.checkRun]);

  const diagnoseCheckEnvironment = useCallback(async (profile: BuilderCheckRunProfile) => {
    const draftId = currentDraftId;
    if (draftId === null) return;
    setCheckEnvironmentDiagnosis(Object.freeze({
      command_profile_id: profile.command_profile_id,
      status: 'loading',
    }));
    try {
      const result = await ports.checkRun.diagnoseCurrentDraftCheckEnvironment({
        draft_id: draftId,
        command_profile_id: profile.command_profile_id,
      });
      if (projectSnapshotRef.current.draft?.draft_id !== draftId
        || result.draft_id !== draftId
        || result.environment_diagnosis.command_profile_id !== profile.command_profile_id) return;
      setCheckEnvironmentDiagnosis(Object.freeze({
        command_profile_id: profile.command_profile_id,
        status: 'ready',
        diagnosis: result.environment_diagnosis,
      }));
    } catch (error) {
      if (projectSnapshotRef.current.draft?.draft_id !== draftId) return;
      const failureCode = classifyCheckRunOperationFailureCode(error);
      const failureMessage = failureCode === 'busy'
        ? 'A project check is already running. Try again when it finishes.'
        : failureCode === 'stale_draft'
          ? 'This draft or check option changed. Refresh the current draft and try again.'
          : failureCode === 'invalid_request'
            ? 'Builder could not verify this diagnosis request. Refresh the draft and try again.'
            : failureCode === 'forbidden'
              ? 'The diagnosis request did not come from the active Builder window. Try again from this window.'
              : 'I could not read the check environment diagnosis. Try again.';
      setCheckEnvironmentDiagnosis(Object.freeze({
        command_profile_id: profile.command_profile_id,
        status: 'failed',
        failure_message: failureMessage,
      }));
    }
  }, [currentDraftId, ports.checkRun]);

  const diagnoseProjectEnvironment = useCallback(async (targetProjectId: string) => {
    setProjectEnvironmentDiagnosis(Object.freeze({
      project_id: targetProjectId,
      status: 'loading',
    }));
    try {
      const result = await ports.checkRun.diagnoseProjectEnvironment({
        project_id: targetProjectId,
      });
      if (projectId !== targetProjectId || result.project_id !== targetProjectId) return;
      setProjectEnvironmentDiagnosis(Object.freeze({
        project_id: targetProjectId,
        status: 'ready',
        diagnosis: result.environment_diagnosis,
      }));
    } catch {
      if (projectId !== targetProjectId) return;
      setProjectEnvironmentDiagnosis(Object.freeze({
        project_id: targetProjectId,
        status: 'failed',
        failure_message: 'I could not read the project environment diagnosis. Try again.',
      }));
    }
  }, [ports.checkRun, projectId]);

  const prepareProjectDependencies = useCallback(async (targetProjectId: string) => {
    setProjectDependencyPreparation(Object.freeze({
      project_id: targetProjectId,
      status: 'preparing',
    }));
    try {
      const result = await ports.checkRun.prepareProjectDependencies({
        project_id: targetProjectId,
      });
      if (projectId !== targetProjectId || result.project_id !== targetProjectId) return;
      setProjectEnvironmentDiagnosis(Object.freeze({
        project_id: targetProjectId,
        status: 'ready',
        diagnosis: result.environment_diagnosis,
      }));
      if ([
        'failed',
        'timed_out',
        'unsupported',
      ].includes(result.preparation_receipt.status)) {
        const failureMessage = result.preparation_receipt.status === 'timed_out'
          ? 'Project dependency preparation reached the time limit. You can retry once the package manager is responsive.'
          : result.preparation_receipt.status === 'unsupported'
            ? 'Builder could not safely prepare this project folder from the current diagnosis.'
            : 'Project dependency preparation failed. Check diagnostics and try again.';
        setProjectDependencyPreparation(Object.freeze({
          project_id: targetProjectId,
          status: 'failed',
          failure_message: failureMessage,
        }));
        return;
      }
      setProjectDependencyPreparation(null);
    } catch {
      if (projectId !== targetProjectId) return;
      setProjectDependencyPreparation(Object.freeze({
        project_id: targetProjectId,
        status: 'failed',
        failure_message: 'I could not prepare this project folder. Check diagnostics and try again.',
      }));
      void diagnoseProjectEnvironment(targetProjectId);
    }
  }, [diagnoseProjectEnvironment, ports.checkRun, projectId]);

  useEffect(() => {
    if (agentWorkbenchSelected) return;
    const visibleProjectId = visibleConversationProjectId(project.snapshot);
    if (
      visibleProjectId === null
      || currentDraftId !== null
      || project.snapshot.busy
    ) return;
    const revisionKey = project.snapshot.savedProject?.target.revision_receipt_digest
      ?? project.snapshot.workingProjectId
      ?? 'workspace';
    const diagnosisKey = `${visibleProjectId}:${revisionKey}`;
    if (projectEnvironmentAutoDiagnosisKeyRef.current === diagnosisKey) return;
    projectEnvironmentAutoDiagnosisKeyRef.current = diagnosisKey;
    void diagnoseProjectEnvironment(visibleProjectId);
  }, [
    agentWorkbenchSelected,
    currentDraftId,
    diagnoseProjectEnvironment,
    project.snapshot,
  ]);

  useEffect(() => {
    if (queuedActiveRunFollowup === null) return undefined;
    const dispatchQueuedFollowup = () => {
      const queued = queuedActiveRunFollowupRef.current;
      if (queued === null) return;
      if (workspaceEpochRef.current !== queued.epoch) {
        publishQueuedActiveRunFollowup(null);
        return;
      }
      if (projectSnapshotRef.current.busy || submitInFlightRef.current) return;
      if (agentWorkbenchSelectedRef.current && agentSubmitInFlightRef.current) return;
      publishQueuedActiveRunFollowup(null);
      void submitInstructionTextRef.current?.(queued.instruction, {
        existingMessageId: queued.messageId,
        queuedFollowup: queued.queuedFollowup,
      });
    };
    const initialHandle = window.setTimeout(dispatchQueuedFollowup, 0);
    const intervalHandle = window.setInterval(dispatchQueuedFollowup, 50);
    return () => {
      window.clearTimeout(initialHandle);
      window.clearInterval(intervalHandle);
    };
  }, [publishQueuedActiveRunFollowup, queuedActiveRunFollowup]);

  useEffect(() => {
    if (lockedComposerSubmit === null || submitInFlight) return;
    const pending = lockedComposerSubmitRef.current;
    if (pending === null) return;
    if (workspaceEpochRef.current !== pending.epoch) {
      publishLockedComposerSubmit(null);
      return;
    }
    publishLockedComposerSubmit(null);
    void submitInstructionTextRef.current?.(pending.instruction, pending.options);
  }, [lockedComposerSubmit, publishLockedComposerSubmit, submitInFlight]);

  useLayoutEffect(() => {
    liveOutputRef.current = liveOutput;
    if (liveOutput === null) liveOutputStore.clear();
  }, [liveOutput, liveOutputStore]);

  // StrictMode replays effect cleanup during development, so component cleanup
  // must leave this memoized store reusable for the second setup pass.
  useEffect(() => () => liveOutputStore.clear(), [liveOutputStore]);
  useEffect(() => () => agentLiveOutputStore.clear(), [agentLiveOutputStore]);

  useEffect(() => () => commandOutputStore.dispose(), [commandOutputStore]);

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
    commandApprovalRef.current = commandApproval;
  }, [commandApproval]);

  useLayoutEffect(() => {
    currentProjectWriteApprovalStatusRef.current = currentProjectWriteApprovalStatus;
  }, [currentProjectWriteApprovalStatus]);

  const { retainConversationProject } = project;

  const publishPlanReviewInFlight = useCallback((value: BuilderPlanReviewInFlight | null) => {
    planReviewInFlightRef.current = value;
    setPlanReviewInFlight(value);
  }, []);

  useEffect(() => (
    ports.generator.subscribeStarted?.((event) => {
      if (event.request_id === agentRequestIdRef.current) {
        const nextLiveOutput: BuilderLiveOutputSnapshot = Object.freeze({
          state: 'streaming', request_id: event.request_id, project_id: event.project_id,
          text: '', chunk_count: 0,
        });
        agentLiveOutputStore.start(nextLiveOutput);
        setAgentLiveOutput(nextLiveOutput);
        return;
      }
      if (agentWorkbenchSelectedRef.current) return;
      commandApprovalRef.current = null;
      setCommandApproval(null);
      commandOutputStore.clear();
      const currentSnapshot = projectSnapshotRef.current;
      const visibleProjectId = visibleConversationProjectId(currentSnapshot);
      if (!currentSnapshot.busy) return;
      if (visibleProjectId !== null && visibleProjectId !== event.project_id) return;
      if (event.project_id !== null) retainConversationProject(event.project_id);
      const nextLiveOutput = Object.freeze({
        state: 'streaming',
        request_id: event.request_id,
        project_id: event.project_id,
        text: '',
        chunk_count: 0,
      });
      liveOutputRef.current = nextLiveOutput;
      liveOutputStore.start(nextLiveOutput);
      setLiveOutput(nextLiveOutput);
    }) ?? (() => undefined)
  ), [agentLiveOutputStore, commandOutputStore, liveOutputStore, ports.generator, retainConversationProject]);

  useEffect(() => (
    ports.generator.subscribeOutput?.((event) => {
      if (event.request_id === agentRequestIdRef.current) agentLiveOutputStore.append(event);
      else liveOutputStore.append(event);
    }) ?? (() => undefined)
  ), [agentLiveOutputStore, liveOutputStore, ports.generator]);

  useEffect(() => (
    ports.generator.subscribeCommandApproval?.((request) => {
      const currentConversation = conversationSnapshotRef.current;
      if (
        !projectSnapshotRef.current.busy
        || currentConversation.project_id !== request.project_id
        || currentConversation.conversation?.state !== 'ready'
        || currentConversation.conversation.conversation.conversation_id !== request.conversation_id
      ) return;
      const prompt = Object.freeze({ request, state: 'pending' as const });
      commandApprovalRef.current = prompt;
      setCommandApproval(prompt);
      commandOutputStore.start(request);
    }) ?? (() => undefined)
  ), [commandOutputStore, ports.generator]);

  useEffect(() => (
    ports.generator.subscribeCommandOutput?.((event: BuilderCommandOutputEvent) => {
      commandOutputStore.append(event);
    }) ?? (() => undefined)
  ), [commandOutputStore, ports.generator]);

  useEffect(() => {
    const commandOutput = commandOutputStore.getSnapshot();
    const snapshot = conversation.snapshot;
    if (
      commandOutput === null
      || snapshot.project_id !== commandOutput.project_id
      || snapshot.conversation?.state !== 'ready'
      || snapshot.conversation.conversation.conversation_id !== commandOutput.conversation_id
    ) return;
    const activity = [...snapshot.conversation.conversation.items].reverse().find((item) => (
      item.item_kind === 'programming_runtime_tool_activity'
      && item.tool_kind === 'command'
      && item.run_id === commandOutput.run_id
      && item.target_label === commandOutput.command_display
      && item.state !== 'running'
    ));
    if (activity?.item_kind !== 'programming_runtime_tool_activity') return;
    commandOutputStore.setState(
      activity.state === 'completed' ? 'completed' : 'failed',
      activity.check_result?.summary ?? activity.summary,
      activity.presentation_detail?.detail_kind === 'command'
        && activity.presentation_detail.truncated,
    );
  }, [commandOutputStore, conversation.snapshot]);

  const resetWorkspace = useCallback((
    nextProjectId: string | undefined,
    options: Readonly<{
      agentWorkbench?: boolean;
      preserveIdea?: boolean;
      preserveWorkspaceController?: boolean;
      taskAddressId?: string | null;
    }> = Object.freeze({}),
  ) => {
    const preserveWorkspaceController = options.preserveWorkspaceController === true;
    const nextEpoch = preserveWorkspaceController
      ? workspaceEpochRef.current
      : workspaceEpochRef.current + 1;
    if (!preserveWorkspaceController) workspaceEpochRef.current = nextEpoch;
    workbenchDraftReturnRef.current = null;
    planSourceReadApprovalRef.current = null;
    currentProjectWriteApprovalRef.current = null;
    commandApprovalRef.current = null;
    commandOutputStore.clear();
    currentProjectWriteApprovalStatusRef.current = null;
    submitInFlightInstructionRef.current = null;
    pendingProjectActivityRestoreRef.current = nextProjectId === undefined
      ? null
      : Object.freeze({ epoch: nextEpoch, projectId: nextProjectId });
    publishLockedComposerSubmit(null);
    publishQueuedActiveRunFollowup(null);
    setPlanReviewFailure(null);
    setPlanReviewRecorded(null);
    setApprovedPlanContinuationFailure(null);
    setAnswerFailureRecordedSuccess(false);
    setPlanSourceReadApproval(null);
    setCurrentProjectWriteApproval(null);
    setCommandApproval(null);
    setCurrentProjectWriteApprovalStatus(null);
    publishPlanReviewInFlight(null);
    restoreAttemptCountsRef.current.clear();
    restoreAttemptsInFlightRef.current.clear();
    activityRestoreLoadAttemptsRef.current.clear();
    activityRestoreLoadsInFlightRef.current.clear();
    activityRestoreProbeKeysRef.current.clear();
    automaticDraftRestoreSuppressedProjectIdsRef.current.clear();
    publishSubmitInFlight(false);
    if (!preserveWorkspaceController) setWorkspaceEpoch(workspaceEpochRef.current);
    setAgentWorkbenchSelected(options.agentWorkbench === true);
    agentWorkbenchSelectedRef.current = options.agentWorkbench === true;
    setProjectId(nextProjectId);
    setTaskAddressId(nextProjectId === undefined ? null : (options.taskAddressId ?? null));
    composerModeRef.current = options.agentWorkbench === true ? agentComposerModeRef.current : null;
    setComposerMode(composerModeRef.current);
    if (nextProjectId !== undefined) {
      globalThis.setTimeout(() => {
        if (workspaceEpochRef.current !== nextEpoch) return;
        restorePendingDraftFromActivityRef.current?.(nextProjectId, nextEpoch);
      }, PENDING_DRAFT_RESTORE_RETRY_DELAY_MS);
    }
    if (options.preserveIdea !== true) setIdea('');
    if (nextProjectId === undefined) setActiveFile(null);
    setLiveOutput(null);
    setView('project');
    return nextEpoch;
  }, [
    commandOutputStore,
    publishLockedComposerSubmit,
    publishPlanReviewInFlight,
    publishQueuedActiveRunFollowup,
    publishSubmitInFlight,
  ]);

  const openProject = useCallback((nextProjectId: string) => {
    const selectedTaskAddressId = firstTaskAddressForProject(
      agentProjectTree.snapshot.tree,
      nextProjectId,
    );
    resetWorkspace(nextProjectId, { taskAddressId: selectedTaskAddressId });
    setRetainedTaskConversationSeed(taskConversationSeed(taskForAddress(
      agentProjectTree.snapshot.tree,
      selectedTaskAddressId,
    )));
  }, [agentProjectTree.snapshot.tree, resetWorkspace]);

  const openTask = useCallback((
    nextProjectId: string,
    nextTaskAddressId: string,
    eventSeed: BuilderTaskConversationSeed | null = null,
  ): number => {
    const nextTaskConversationSeed = taskConversationSeed(taskForAddress(
      agentProjectTree.snapshot.tree,
      nextTaskAddressId,
    )) ?? taskConversationSeed(
      agentWorkbench.snapshot.projection?.task_monitor.tasks.find(
        (task) => task.task_address_id === nextTaskAddressId,
      ) ?? null,
    ) ?? (eventSeed?.task_address_id === nextTaskAddressId ? eventSeed : null);
    const retainedDraft = workbenchDraftReturnRef.current;
    const returningToRetainedDraft = (
      retainedDraft?.projectId === nextProjectId
      && retainedDraft.taskAddressId === nextTaskAddressId
    );
    const nextEpoch = resetWorkspace(nextProjectId, {
      preserveWorkspaceController: returningToRetainedDraft,
      taskAddressId: nextTaskAddressId,
    });
    if (
      retainedDraft?.projectId === nextProjectId
      && retainedDraft.taskAddressId === nextTaskAddressId
    ) {
      workbenchDraftReturnRef.current = Object.freeze({ ...retainedDraft, epoch: nextEpoch });
    }
    setRetainedTaskConversationSeed(nextTaskConversationSeed);
    return nextEpoch;
  }, [agentProjectTree.snapshot.tree, agentWorkbench.snapshot.projection, resetWorkspace]);

  const openAgentWorkbench = useCallback(() => {
    const current = projectSnapshotRef.current;
    const currentTaskAddressId = taskAddressId ?? (
      conversationSnapshotRef.current.project_id === current.draft?.project_id
        ? conversationSnapshotRef.current.task_address_id
        : null
    );
    const retainedDraft = current.draft !== null && currentTaskAddressId !== null
      ? Object.freeze({
          draftId: current.draft.draft_id,
          projectId: current.draft.project_id,
          restoreKey: `workbench:${currentTaskAddressId}:${current.draft.draft_id}`,
          taskAddressId: currentTaskAddressId,
        })
      : null;
    const nextEpoch = resetWorkspace(undefined, {
      agentWorkbench: true,
      preserveWorkspaceController: true,
    });
    setRetainedTaskConversationSeed(null);
    if (retainedDraft !== null) {
      workbenchDraftReturnRef.current = Object.freeze({ ...retainedDraft, epoch: nextEpoch });
    }
  }, [resetWorkspace, taskAddressId]);

  const decideAgentTaskProposal = useCallback(async (
    proposalId: string,
    operation: 'approve_existing_project' | 'reject',
    targetProjectId: string | null,
    options: Readonly<{ autoApproveCurrentProjectWrite?: boolean }> = Object.freeze({}),
  ) => {
    const next = await agentWorkbench.decideTaskProposal({
      proposal_id: proposalId,
      operation,
      project_id: targetProjectId,
    });
    await Promise.all([
      catalog.refresh().catch(() => undefined),
      agentProjectTree.refresh().catch(() => undefined),
    ]);
    const action = next.projection?.stream.items
      .flatMap((item) => item.actions)
      .find((candidate) => candidate.proposal_id === proposalId);
    if (action?.status === 'materialized' && action.project_id !== null && action.task_address_id !== null) {
      const nextEpoch = openTask(action.project_id, action.task_address_id);
      if (action.execution_mode === 'foreground' && action.requested_outcome !== 'discuss') {
        pendingAgentTaskHandoffStartRef.current = Object.freeze({
          autoApproveCurrentProjectWrite: options.autoApproveCurrentProjectWrite === true,
          composerMode: composerModeForAgentTaskProposal(action),
          epoch: nextEpoch,
          instruction: action.objective,
          messageId: `agent-task-proposal:${action.proposal_id}`,
          projectId: action.project_id,
          taskAddressId: action.task_address_id,
        });
      }
    }
  }, [agentProjectTree, agentWorkbench, catalog, openTask]);

  const controlAgentTask = useCallback((
    projectId: string,
    nextTaskAddressId: string,
    operation: 'cancel_task',
  ) => agentWorkbench.controlTask({
    project_id: projectId,
    task_address_id: nextTaskAddressId,
    operation,
  }), [agentWorkbench]);

  const decideAgentPlan = useCallback((
    agentPlanId: string,
    contentDigest: string,
    decision: 'approved' | 'rejected',
  ) => agentWorkbench.decideAgentPlan({
    agent_plan_id: agentPlanId,
    content_digest: contentDigest,
    decision,
  }), [agentWorkbench]);

  const createProjectForAgentTaskProposal = useCallback(async (
    proposalId: string,
    objective: string,
  ) => {
    if (agentTaskProposalProjectCreationInFlightRef.current.has(proposalId)) return;
    agentTaskProposalProjectCreationInFlightRef.current.add(proposalId);
    publishSubmitInFlight(true);
    try {
      const title = objective.split(/\r?\n/u, 1)[0].trim().slice(0, 80) || 'New project';
      const created = await project.createNewLocalProject(title);
      const createdProjectId = visibleConversationProjectId(created);
      if (createdProjectId === null) return;
      await decideAgentTaskProposal(
        proposalId,
        'approve_existing_project',
        createdProjectId,
        { autoApproveCurrentProjectWrite: true },
      );
    } finally {
      agentTaskProposalProjectCreationInFlightRef.current.delete(proposalId);
      publishSubmitInFlight(false);
    }
  }, [decideAgentTaskProposal, project, publishSubmitInFlight]);

  const startNewTask = useCallback((nextProjectId: string) => {
    resetWorkspace(nextProjectId, { taskAddressId: null });
  }, [resetWorkspace]);

  const clearPendingProjectActivityRestore = useCallback(() => {
    pendingProjectActivityRestoreRef.current = null;
    activityRestoreLoadAttemptsRef.current.clear();
    activityRestoreLoadsInFlightRef.current.clear();
    activityRestoreProbeKeysRef.current.clear();
  }, []);

  const startNewProjectFromCatalog = useCallback(() => {
    resetWorkspace(undefined, { agentWorkbench: true });
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
    const autoOpenEpoch = workspaceEpochRef.current;
    window.setTimeout(() => {
      if (workspaceEpochRef.current !== autoOpenEpoch) return;
      if (projectSnapshotRef.current.status !== 'new') return;
      openProject(workspaceProjectId);
    });
  }, [catalog.snapshot, openProject, projectId]);

  const lifecycleAgentId = agentProjectTree.snapshot.tree?.agent_id ?? DEFAULT_BUILDER_AGENT_ID;
  const refreshLifecycleViews = useCallback((
    options: Readonly<{ agentWorkbench?: boolean }> = Object.freeze({ agentWorkbench: true }),
  ): Promise<void> => {
    lifecycleRefreshQueuedRef.current = true;
    if (options.agentWorkbench !== false) lifecycleRefreshNeedsWorkbenchRef.current = true;
    if (lifecycleRefreshInFlightRef.current !== null) return lifecycleRefreshInFlightRef.current;
    const drainRefreshes = async () => {
      while (lifecycleRefreshQueuedRef.current) {
        const refreshWorkbench = lifecycleRefreshNeedsWorkbenchRef.current;
        lifecycleRefreshQueuedRef.current = false;
        lifecycleRefreshNeedsWorkbenchRef.current = false;
        await Promise.all([
          catalog.refresh().catch(() => undefined),
          agentProjectTree.refresh().catch(() => undefined),
          ...(refreshWorkbench
            ? [agentWorkbench.refresh().catch(() => undefined)]
            : []),
        ]);
      }
    };
    const running = drainRefreshes().finally(() => {
      lifecycleRefreshInFlightRef.current = null;
    });
    lifecycleRefreshInFlightRef.current = running;
    return running;
  }, [agentProjectTree, agentWorkbench, catalog]);

  const refreshCatalog = useCallback(() => {
    void refreshLifecycleViews({ agentWorkbench: false });
  }, [refreshLifecycleViews]);

  const renameAgentProject = useCallback(async (targetProjectId: string, title: string) => {
    await ports.agentProjectTree.renameProject({
      agent_id: lifecycleAgentId,
      project_id: targetProjectId,
      title,
    });
    await refreshLifecycleViews();
  }, [lifecycleAgentId, ports.agentProjectTree, refreshLifecycleViews]);

  const archiveAgentProject = useCallback(async (targetProjectId: string) => {
    await ports.agentProjectTree.archiveProject({
      agent_id: lifecycleAgentId,
      project_id: targetProjectId,
    });
    if (targetProjectId === projectId) {
      resetWorkspace(undefined, { taskAddressId: null });
    }
    await refreshLifecycleViews();
  }, [lifecycleAgentId, ports.agentProjectTree, projectId, refreshLifecycleViews, resetWorkspace]);

  const renameAgentTask = useCallback(async (
    targetProjectId: string,
    nextTaskAddressId: string,
    title: string,
  ) => {
    await ports.agentProjectTree.renameTask({
      agent_id: lifecycleAgentId,
      project_id: targetProjectId,
      task_address_id: nextTaskAddressId,
      title,
    });
    await refreshLifecycleViews();
  }, [lifecycleAgentId, ports.agentProjectTree, refreshLifecycleViews]);

  const archiveAgentTask = useCallback(async (
    targetProjectId: string,
    nextTaskAddressId: string,
  ) => {
    await ports.agentProjectTree.archiveTask({
      agent_id: lifecycleAgentId,
      project_id: targetProjectId,
      task_address_id: nextTaskAddressId,
    });
    if (nextTaskAddressId === taskAddressId) {
      resetWorkspace(targetProjectId, { taskAddressId: null });
    }
    await refreshLifecycleViews();
  }, [lifecycleAgentId, ports.agentProjectTree, refreshLifecycleViews, resetWorkspace, taskAddressId]);

  const exportAgentTaskTranscript = useCallback(async (
    targetProjectId: string,
    nextTaskAddressId: string,
  ) => {
    const serial = taskTranscriptExportSerialRef.current + 1;
    taskTranscriptExportSerialRef.current = serial;
    if (taskTranscriptExportFeedbackTimerRef.current !== null) {
      window.clearTimeout(taskTranscriptExportFeedbackTimerRef.current);
      taskTranscriptExportFeedbackTimerRef.current = null;
    }
    setTaskTranscriptExportFeedback({
      message: 'Exporting transcript...',
      state: 'exporting',
      taskAddressId: nextTaskAddressId,
    });
    try {
      const result = await ports.agentProjectTree.exportTaskTranscript({
        agent_id: lifecycleAgentId,
        project_id: targetProjectId,
        task_address_id: nextTaskAddressId,
      });
      const download = taskTranscriptDownloadFromExport(result);
      if (download === null || download.taskAddressId !== nextTaskAddressId) throw new Error('invalid transcript export');
      downloadTaskTranscript(download);
      if (taskTranscriptExportSerialRef.current !== serial) return;
      setTaskTranscriptExportFeedback({
        message: `Downloaded ${download.filename}.`,
        state: 'ready',
        taskAddressId: nextTaskAddressId,
      });
      taskTranscriptExportFeedbackTimerRef.current = window.setTimeout(() => {
        if (taskTranscriptExportSerialRef.current === serial) setTaskTranscriptExportFeedback(null);
      }, TASK_TRANSCRIPT_EXPORT_FEEDBACK_CLEAR_MS);
    } catch {
      if (taskTranscriptExportSerialRef.current !== serial) return;
      setTaskTranscriptExportFeedback({
        message: 'Transcript export failed.',
        state: 'failed',
        taskAddressId: nextTaskAddressId,
      });
    }
  }, [lifecycleAgentId, ports.agentProjectTree]);

  const openProjectLocation = useCallback(async (targetProjectId: string) => {
    await ports.workspace.openLocation({ project_id: targetProjectId }).catch(() => undefined);
  }, [ports.workspace]);

  const readActivityAfterTerminal = useCallback(async (
    result: BuilderVisibleProjectSnapshot,
    commandEpoch: number,
    fallbackProjectId: string | null = null,
    scope: 'project' | 'agent' = 'project',
  ): Promise<BuilderConversationControllerSnapshot | null> => {
    if (workspaceEpochRef.current !== commandEpoch) return null;
    const conversationProjectId = scope === 'agent'
      ? null : visibleConversationProjectId(result) ?? fallbackProjectId;
    if (conversationProjectId === null) {
      if (conversation.snapshot.agent_id === null) return null;
      const [activity] = await Promise.all([
        boundedPostTerminalRefresh(conversation.refresh(), null),
        boundedPostTerminalRefresh(agentWorkbench.refresh(), null),
      ]);
      return activity;
    }
    const currentConversationTaskAddressId = conversation.snapshot.project_id === conversationProjectId
      ? conversation.snapshot.task_address_id
      : null;
    let nextTaskAddressId = currentConversationTaskAddressId ?? taskAddressId;
    if (taskAddressId === null && currentConversationTaskAddressId !== null) {
      setTaskAddressId(currentConversationTaskAddressId);
    }
    if (nextTaskAddressId === null) {
      const refreshedTree = await boundedPostTerminalRefresh(agentProjectTree.refresh(), null);
      nextTaskAddressId = firstTaskAddressForProject(
        refreshedTree?.tree ?? null,
        conversationProjectId,
      );
      if (nextTaskAddressId === null) return conversation.snapshot;
      setTaskAddressId(nextTaskAddressId);
    }
    const activity = conversation.snapshot.project_id === conversationProjectId
      && conversation.snapshot.task_address_id === nextTaskAddressId
      ? await boundedPostTerminalRefresh(conversation.refresh(), null)
      : await boundedPostTerminalRefresh(
        conversation.load(conversationProjectId, nextTaskAddressId),
        null,
      );
    return activity;
  }, [agentProjectTree, agentWorkbench, conversation, taskAddressId]);

  const runBuildInstruction = useCallback((
    instruction: string,
    composerMode: BuilderComposerMode | null,
    queuedFollowup: BuilderQueuedFollowupReference | null,
  ) => {
    if (
      composerMode === 'build'
      && queuedFollowup === null
      && projectSnapshotRef.current.draft === null
    ) {
      return project.generate(instruction);
    }
    return project.submit(instruction, queuedFollowup);
  }, [project]);

  const createWorkspaceProject = useCallback(async (projectTitle: string) => {
    if (projectTitle.trim().length === 0) return;
    if (submitInFlightRef.current) return;
    const commandEpoch = workspaceEpochRef.current;
    publishSubmitInFlight(true);
    try {
      setView('project');
      const result = await project.createLocalProject(projectTitle);
      if (workspaceEpochRef.current !== commandEpoch) return;
      const workspaceReady = result.workingProjectId !== null || result.savedProject !== null;
      if (workspaceReady) {
        agentWorkbenchSelectedRef.current = false;
        setAgentWorkbenchSelected(false);
        projectSnapshotRef.current = result;
        setProjectId(result.workingProjectId ?? result.savedProject?.target.project_id);
        setActiveFile(null);
        setLiveOutput(null);
        await Promise.all([
          catalog.refresh().catch(() => undefined),
          agentProjectTree.refresh().catch(() => undefined),
        ]);
      }
    } finally {
      publishSubmitInFlight(false);
    }
  }, [
    agentProjectTree,
    catalog,
    project,
    publishSubmitInFlight,
  ]);

  useEffect(() => {
    if (!catalogNewProjectPending) return;
    const snapshot = projectSnapshotRef.current;
    if (snapshot.busy || snapshot.status !== 'new') return;
    const handle = window.setTimeout(() => {
      setCatalogNewProjectPending(false);
      void createWorkspaceProject('New project');
    }, 0);
    return () => window.clearTimeout(handle);
  }, [catalogNewProjectPending, createWorkspaceProject]);

  const refreshActiveConversation = useCallback(async (commandEpoch: number) => {
    if (workspaceEpochRef.current !== commandEpoch) return;
    if (agentWorkbenchSelectedRef.current) {
      await conversation.refresh().catch(() => undefined);
      return;
    }
    const live = liveOutputRef.current;
    const projectId = visibleConversationProjectId(projectSnapshotRef.current) ?? live?.project_id ?? null;
    if (projectId === null) return;
    if (taskAddressId === null) return;
    if (
      conversation.snapshot.project_id === projectId
      && conversation.snapshot.task_address_id === taskAddressId
    ) {
      await conversation.refresh().catch(() => undefined);
    } else {
      await conversation.load(projectId, taskAddressId).catch(() => undefined);
    }
  }, [conversation, taskAddressId]);

  const restorePendingDraftTarget = useCallback((
    target: RestorableDraftTarget,
    commandEpoch: number,
  ) => {
    const attemptKey = `${commandEpoch}:${target.restoreKey}`;
    if (automaticDraftRestoreSuppressedProjectIdsRef.current.has(target.projectId)) return;
    if (restoreAttemptsInFlightRef.current.has(attemptKey)) return;
    const attemptRestore = () => {
      if (workspaceEpochRef.current !== commandEpoch) {
        restoreAttemptsInFlightRef.current.delete(attemptKey);
        return;
      }
      if (restoreAttemptsInFlightRef.current.has(attemptKey)) return;
      if (automaticDraftRestoreSuppressedProjectIdsRef.current.has(target.projectId)) {
        restoreAttemptCountsRef.current.delete(attemptKey);
        return;
      }
      const attemptCount = restoreAttemptCountsRef.current.get(attemptKey) ?? 0;
      if (attemptCount >= MAX_PENDING_DRAFT_RESTORE_ATTEMPTS) return;
      restoreAttemptCountsRef.current.set(attemptKey, attemptCount + 1);
      restoreAttemptsInFlightRef.current.add(attemptKey);
      void project.restoreDraft(target.draftId).then(async (result) => {
        if (result.inspectedRevision !== null) {
          restoreAttemptCountsRef.current.delete(attemptKey);
          return;
        }
        if (workspaceEpochRef.current !== commandEpoch) return;
        if (result.draft?.draft_id !== target.draftId) {
          if ((restoreAttemptCountsRef.current.get(attemptKey) ?? 0) < MAX_PENDING_DRAFT_RESTORE_ATTEMPTS) {
            globalThis.setTimeout(attemptRestore, PENDING_DRAFT_RESTORE_RETRY_DELAY_MS);
          }
          return;
        }
        restoreAttemptCountsRef.current.delete(attemptKey);
        await readActivityAfterTerminal(result, commandEpoch);
      }).catch(() => {
        if (
          workspaceEpochRef.current === commandEpoch
          && (restoreAttemptCountsRef.current.get(attemptKey) ?? 0) < MAX_PENDING_DRAFT_RESTORE_ATTEMPTS
        ) {
          globalThis.setTimeout(attemptRestore, PENDING_DRAFT_RESTORE_RETRY_DELAY_MS);
        }
      }).finally(() => {
        restoreAttemptsInFlightRef.current.delete(attemptKey);
      });
    };
    globalThis.setTimeout(attemptRestore);
  }, [project, readActivityAfterTerminal]);

  useEffect(() => {
    const target = workbenchDraftReturnRef.current;
    if (
      target === null
      || target.epoch !== workspaceEpochRef.current
      || target.projectId !== projectId
      || target.taskAddressId !== taskAddressId
    ) return;
    if (project.snapshot.draft?.draft_id === target.draftId) {
      workbenchDraftReturnRef.current = null;
      return;
    }
    if (
      project.snapshot.busy
      || project.snapshot.draft !== null
      || project.snapshot.inspectedRevision !== null
      || !['ready', 'generation_failed', 'preview_unavailable'].includes(project.snapshot.status)
    ) return;
    workbenchDraftReturnRef.current = null;
    restorePendingDraftTarget(target, target.epoch);
  }, [project.snapshot, projectId, restorePendingDraftTarget, taskAddressId]);

  const restorePendingDraftFromActivity = useCallback((
    visibleProjectId: string,
    commandEpoch: number,
  ) => {
    if (taskAddressId === null) return;
    const loadKey = `${commandEpoch}:${visibleProjectId}`;
    if (activityRestoreLoadsInFlightRef.current.has(loadKey)) return;
    const retryLoad = () => {
      if (workspaceEpochRef.current !== commandEpoch) {
        activityRestoreLoadAttemptsRef.current.delete(loadKey);
        activityRestoreLoadsInFlightRef.current.delete(loadKey);
        return;
      }
      if (
        pendingProjectActivityRestoreRef.current?.epoch !== commandEpoch
        || pendingProjectActivityRestoreRef.current.projectId !== visibleProjectId
      ) {
        activityRestoreLoadAttemptsRef.current.delete(loadKey);
        activityRestoreLoadsInFlightRef.current.delete(loadKey);
        return;
      }
      const attemptCount = activityRestoreLoadAttemptsRef.current.get(loadKey) ?? 0;
      if (attemptCount >= MAX_PENDING_DRAFT_ACTIVITY_LOAD_ATTEMPTS) {
        activityRestoreLoadsInFlightRef.current.delete(loadKey);
        if (
          pendingProjectActivityRestoreRef.current?.epoch === commandEpoch
          && pendingProjectActivityRestoreRef.current.projectId === visibleProjectId
        ) {
          pendingProjectActivityRestoreRef.current = null;
        }
        return;
      }
      const currentConversation = conversationSnapshotRef.current;
      if (
        currentConversation.busy
        && currentConversation.project_id === visibleProjectId
        && currentConversation.task_address_id === taskAddressId
      ) {
        activityRestoreLoadAttemptsRef.current.set(loadKey, attemptCount + 1);
        globalThis.setTimeout(retryLoad, PENDING_DRAFT_RESTORE_RETRY_DELAY_MS);
        return;
      }
      if (
        currentConversation.status === 'ready'
        && currentConversation.conversation?.state === 'ready'
        && currentConversation.project_id === visibleProjectId
        && attemptCount === 0
      ) {
        const target = latestRestorableDraftForProjectId(
          currentConversation,
          projectSnapshotRef.current,
          visibleProjectId,
        );
        if (target === null) {
          if (hasPendingDraftRestoreProjectionHint(currentConversation, visibleProjectId)) {
            activityRestoreLoadAttemptsRef.current.set(loadKey, 1);
            globalThis.setTimeout(retryLoad, PENDING_DRAFT_RESTORE_RETRY_DELAY_MS);
            return;
          }
          activityRestoreLoadAttemptsRef.current.delete(loadKey);
          activityRestoreLoadsInFlightRef.current.delete(loadKey);
          if (
            pendingProjectActivityRestoreRef.current?.epoch === commandEpoch
            && pendingProjectActivityRestoreRef.current.projectId === visibleProjectId
          ) {
            pendingProjectActivityRestoreRef.current = null;
          }
        } else {
          activityRestoreLoadAttemptsRef.current.delete(loadKey);
          activityRestoreLoadsInFlightRef.current.delete(loadKey);
          if (
            pendingProjectActivityRestoreRef.current?.epoch === commandEpoch
            && pendingProjectActivityRestoreRef.current.projectId === visibleProjectId
          ) {
            pendingProjectActivityRestoreRef.current = null;
          }
          restorePendingDraftTarget(target, commandEpoch);
        }
        return;
      }
      activityRestoreLoadAttemptsRef.current.set(loadKey, attemptCount + 1);
      void conversation.probe(visibleProjectId, taskAddressId).then((loaded) => {
        if (workspaceEpochRef.current !== commandEpoch) return;
        if (
          loaded.status !== 'ready'
          || loaded.conversation?.state !== 'ready'
          || loaded.project_id !== visibleProjectId
        ) {
          globalThis.setTimeout(retryLoad, PENDING_DRAFT_RESTORE_RETRY_DELAY_MS);
          return;
        }
        const target = latestRestorableDraftForProjectId(loaded, projectSnapshotRef.current, visibleProjectId);
        if (target === null) {
          if (
            hasPendingDraftRestoreProjectionHint(loaded, visibleProjectId)
            && attemptCount + 1 < MAX_PENDING_DRAFT_ACTIVITY_LOAD_ATTEMPTS
          ) {
            globalThis.setTimeout(retryLoad, PENDING_DRAFT_RESTORE_RETRY_DELAY_MS);
            return;
          }
          activityRestoreLoadAttemptsRef.current.delete(loadKey);
          activityRestoreLoadsInFlightRef.current.delete(loadKey);
          if (
            pendingProjectActivityRestoreRef.current?.epoch === commandEpoch
            && pendingProjectActivityRestoreRef.current.projectId === visibleProjectId
          ) {
            pendingProjectActivityRestoreRef.current = null;
          }
          return;
        }
        activityRestoreLoadAttemptsRef.current.delete(loadKey);
        activityRestoreLoadsInFlightRef.current.delete(loadKey);
        if (
          pendingProjectActivityRestoreRef.current?.epoch === commandEpoch
          && pendingProjectActivityRestoreRef.current.projectId === visibleProjectId
        ) {
          pendingProjectActivityRestoreRef.current = null;
        }
        restorePendingDraftTarget(target, commandEpoch);
      }).catch(() => {
        if (workspaceEpochRef.current !== commandEpoch) return;
        globalThis.setTimeout(retryLoad, PENDING_DRAFT_RESTORE_RETRY_DELAY_MS);
      });
    };
    activityRestoreLoadsInFlightRef.current.add(loadKey);
    globalThis.setTimeout(retryLoad, 50);
  }, [conversation, restorePendingDraftTarget, taskAddressId]);

  useLayoutEffect(() => {
    restorePendingDraftFromActivityRef.current = restorePendingDraftFromActivity;
  }, [restorePendingDraftFromActivity]);

  useEffect(() => {
    if (projectId === undefined) return;
    const commandEpoch = workspaceEpochRef.current;
    const pendingRestore = pendingProjectActivityRestoreRef.current;
    if (
      pendingRestore === null
      || pendingRestore.epoch !== commandEpoch
      || pendingRestore.projectId !== projectId
    ) return;
    restorePendingDraftFromActivity(projectId, commandEpoch);
  }, [projectId, restorePendingDraftFromActivity, workspaceEpoch]);

  useEffect(() => {
    const target = latestRestorableDraft(conversation.snapshot, project.snapshot);
    if (target === null) return;
    restorePendingDraftTarget(target, workspaceEpochRef.current);
  }, [conversation.snapshot, project.snapshot, restorePendingDraftTarget]);

  useEffect(() => {
    const visibleProjectId = visibleConversationProjectId(project.snapshot);
    if (
      project.snapshot.busy
      || project.snapshot.draft !== null
      || project.snapshot.inspectedRevision !== null
      || visibleProjectId === null
      || !['ready', 'generation_failed', 'preview_unavailable'].includes(project.snapshot.status)
    ) return;
    let pendingProjectActivityRestore = pendingProjectActivityRestoreRef.current;
    if (pendingProjectActivityRestore === null) {
      if (project.snapshot.savedProject !== null) return;
      const restoreProbeKey = [
        workspaceEpochRef.current,
        visibleProjectId,
        project.snapshot.workingProjectId
          ?? project.snapshot.conversationProjectId
          ?? 'current',
      ].join(':');
      if (activityRestoreProbeKeysRef.current.has(restoreProbeKey)) return;
      activityRestoreProbeKeysRef.current.add(restoreProbeKey);
      pendingProjectActivityRestore = Object.freeze({
        epoch: workspaceEpochRef.current,
        projectId: visibleProjectId,
      });
      pendingProjectActivityRestoreRef.current = pendingProjectActivityRestore;
    }
    if (
      pendingProjectActivityRestore.epoch !== workspaceEpochRef.current
      || pendingProjectActivityRestore.projectId !== visibleProjectId
    ) return;
    const commandEpoch = workspaceEpochRef.current;
    restorePendingDraftFromActivity(visibleProjectId, commandEpoch);
  }, [conversation.snapshot, project.snapshot, restorePendingDraftFromActivity]);

  const steerInstruction = useCallback(async () => {
    if (idea.trim().length === 0) return;
    const live = agentWorkbenchSelectedRef.current ? agentLiveOutputStore.getSnapshot() : liveOutputRef.current;
    if (live === null || !projectSnapshotRef.current.busy) return;
    const commandEpoch = workspaceEpochRef.current;
    const submittedIdea = idea;
    setIdea('');
    const steered = await activeConversation.steer(submittedIdea);
    if (workspaceEpochRef.current !== commandEpoch) return;
    if (!steered) {
      setIdea(submittedIdea);
      return;
    }
    publishPendingUserMessage(submittedIdea, 'steering');
    await refreshActiveConversation(commandEpoch);
  }, [activeConversation, agentLiveOutputStore, idea, publishPendingUserMessage, refreshActiveConversation]);

  const queueActiveRunFollowupInstruction = useCallback(async (
    submittedIdea: string,
    routeEvidence: BuilderComposerRouteDecisionEvidence,
  ) => {
    const commandEpoch = workspaceEpochRef.current;
    const pendingMessage = publishPendingUserMessage(submittedIdea, 'queued_followup');
    const queued = await activeConversation.queueFollowup(submittedIdea);
    if (workspaceEpochRef.current !== commandEpoch) return;
    if (queued === null) {
      dismissPendingUserMessage(pendingMessage?.client_id ?? null);
      return;
    }
    if (queued.queued_followup === null) {
      dismissPendingUserMessage(pendingMessage?.client_id ?? null);
      return;
    }
    bindPendingUserMessage(pendingMessage?.client_id ?? null, {
      message_id: queued.queued_followup.message_id,
      turn_id: queued.queued_followup.turn_id,
    });
    await refreshActiveConversation(commandEpoch);
    if (workspaceEpochRef.current !== commandEpoch) return;
    publishQueuedActiveRunFollowup(Object.freeze({
      epoch: commandEpoch,
      instruction: submittedIdea,
      messageId: routeEvidence.messageId,
      queuedFollowup: queued.queued_followup,
    }));
    setIdea('');
  }, [
    bindPendingUserMessage,
    dismissPendingUserMessage,
    activeConversation,
    publishPendingUserMessage,
    publishQueuedActiveRunFollowup,
    refreshActiveConversation,
  ]);

  const continueApprovedPlanAfterWriteApproval = useCallback(async (
    continuation: BuilderApprovedPlanContinuation,
    commandEpoch: number,
  ) => {
    setLiveOutput(null);
    const result = await project.generateApprovedPlan(continuation);
    if (workspaceEpochRef.current !== commandEpoch) return;
    setApprovedPlanContinuationFailure(result.status === 'generation_failed' ? continuation : null);
    await readActivityAfterTerminal(result, commandEpoch, continuation.project_id);
    setLiveOutput(null);
  }, [project, readActivityAfterTerminal]);

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
    if (taskAddressId !== null) {
      await conversation.load(request.project_id, taskAddressId).catch(() => undefined);
    }
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
    let approval: BuilderCurrentProjectWriteApprovalStatus;
    try {
      approval = await ports.generator.prepareCurrentProjectWriteApproval({
        project_id: request.project_id,
        task_address_id: taskAddressId,
      });
    } catch {
      approval = Object.freeze({
        result_version: 'builder-current-project-write-approval-status.v1',
        project_id: request.project_id,
        state: 'approval_required' as const,
        approval_scope: 'current_project_write' as const,
        authority: 'main_selected_project_project_edit_v1' as const,
      });
    }
    if (workspaceEpochRef.current !== commandEpoch) return;
    const nextPermissionStatus = Object.freeze({
      project_id: request.project_id,
      state: approval.state,
    });
    currentProjectWriteApprovalStatusRef.current = nextPermissionStatus;
    setCurrentProjectWriteApprovalStatus(nextPermissionStatus);
    const continuation = Object.freeze({
      project_id: request.project_id,
      conversation_id: request.conversation_id,
      turn_id: request.turn_id,
      run_id: request.run_id,
    });
    if (approval.state === 'approval_required') {
      const prompt = Object.freeze({
        composerMode: null,
        project_id: request.project_id,
        instruction: 'Apply the approved plan.',
        message_id: `approved-plan:${inFlightKey}`,
        queuedFollowup: null,
        approvedPlanContinuation: continuation,
        state: 'pending' as const,
      });
      currentProjectWriteApprovalRef.current = prompt;
      setCurrentProjectWriteApproval(prompt);
      if (
        planReviewInFlightRef.current !== null
        && planReviewInFlightKey(planReviewInFlightRef.current) === inFlightKey
      ) {
        publishPlanReviewInFlight(null);
      }
      return;
    }
    currentProjectWriteApprovalRef.current = null;
    setCurrentProjectWriteApproval(null);
    try {
      await continueApprovedPlanAfterWriteApproval(continuation, commandEpoch);
    } finally {
      if (
        planReviewInFlightRef.current !== null
        && planReviewInFlightKey(planReviewInFlightRef.current) === inFlightKey
      ) {
        publishPlanReviewInFlight(null);
      }
    }
  }, [
    continueApprovedPlanAfterWriteApproval,
    conversation,
    ports.generator,
    ports.planReview,
    publishPlanReviewInFlight,
    taskAddressId,
  ]);

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
    setLiveOutput(null);
    await readActivityAfterTerminal(result, commandEpoch, fallbackProjectId);
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
      || !PLAN_PROPOSAL_READY_STATUSES.has(currentSnapshot.status)
      || submittedIdea.trim().length === 0
    ) return false;
    setApprovedPlanContinuationFailure(null);
    setLiveOutput(null);
    try {
      const approval = await ports.generator.preparePlanSourceReadApproval({
        project_id: fallbackProjectId,
        task_address_id: taskAddressId,
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
      if (workspaceEpochRef.current === commandEpoch) {
        const failed = Object.freeze({
          project_id: fallbackProjectId,
          instruction: submittedIdea,
          file_count: null,
          state: 'failed' as const,
        });
        planSourceReadApprovalRef.current = failed;
        setPlanSourceReadApproval(failed);
        composerModeRef.current = null;
        setComposerMode(null);
        setIdea('');
      }
      return true;
    }
  }, [ports.generator, runPlanProposal, taskAddressId]);

  const submitInstructionText = useCallback<SubmitInstructionText>(async (
    submittedIdea,
    options = Object.freeze({}),
  ) => {
    const trimmedSubmittedIdea = submittedIdea.trim();
    if (trimmedSubmittedIdea.length === 0) return;
    if (agentWorkbenchSelectedRef.current && agentSubmitInFlightRef.current) return;
    if (submitInFlightRef.current) {
      if (submitInFlightInstructionRef.current?.trim() !== trimmedSubmittedIdea) {
        publishLockedComposerSubmit(Object.freeze({
          epoch: workspaceEpochRef.current,
          instruction: submittedIdea,
          options: Object.freeze({ ...options }),
        }));
      }
      return;
    }
    clearPendingProjectActivityRestore();
    publishQueuedActiveRunFollowup(null);
    setAnswerFailureRecordedSuccess(false);
    if (options.queuedFollowup === null || options.queuedFollowup === undefined) {
      publishPendingUserMessage(submittedIdea, 'submitted');
    }
    const activeComposerMode = options.composerModeOverride ?? composerModeRef.current;
    const submittingAgentWorkbench = agentWorkbenchSelectedRef.current;
    const boundedComposerMode = submittingAgentWorkbench && activeComposerMode === 'build'
      ? null
      : activeComposerMode;
    const initialIntentContext = composerIntentContext(
      conversationSnapshotRef.current,
      projectSnapshotRef.current,
      boundedComposerMode,
      currentProjectWriteApprovalStatusRef.current,
      effectiveApprovalMode(
        approvalModeRef.current,
        projectSnapshotRef.current,
        currentProjectWriteApprovalStatusRef.current,
      ),
    );
    let decision = decideBuilderComposerIntent(
      submittedIdea,
      initialIntentContext,
    );
    const pendingPlan = pendingPlanReviewRequest(
      conversationSnapshotRef.current,
      projectSnapshotRef.current,
    );
    if (
      pendingPlan !== null
      && boundedComposerMode !== 'ask'
      && boundedComposerMode !== 'plan'
      && isBuilderComposerContextualBuildIntent(submittedIdea)
    ) {
      const pendingPlanWorkingBrief = composerWorkingBrief(
        conversationSnapshotRef.current,
        projectSnapshotRef.current,
      );
      setComposerRouteDecision(createComposerRouteEvidence(
        decision,
        projectSnapshotRef.current,
        options.existingMessageId ?? null,
        pendingPlanWorkingBrief?.taskId ?? null,
      ));
      setApprovedPlanContinuationFailure(null);
      submitInFlightInstructionRef.current = submittedIdea;
      publishSubmitInFlight(true);
      setIdea('');
      setLiveOutput(null);
      try {
        await reviewPlan(pendingPlan);
      } finally {
        submitInFlightInstructionRef.current = null;
        publishSubmitInFlight(false);
      }
      return;
    }
    let semanticClassification: BuilderSemanticRouteClassification | null = null;
    if (
      boundedComposerMode === null
      && ports.generator.classifyIntent !== undefined
      && shouldRequestSemanticClassifier(decision, submittedIdea)
      && !shouldSkipSemanticClassifierForCurrentDraftBuild(decision, projectSnapshotRef.current, submittedIdea)
    ) {
      const classificationEpoch = workspaceEpochRef.current;
      submitInFlightInstructionRef.current = submittedIdea;
      publishSubmitInFlight(true);
      try {
        const classification = await ports.generator.classifyIntent({
          instruction: submittedIdea,
          task_address_id: taskAddressId,
        });
        if (workspaceEpochRef.current !== classificationEpoch) return;
        semanticClassification = classification;
        decision = decideBuilderComposerSemanticIntent(classification, initialIntentContext);
      } catch {
        decision = decideBuilderComposerSemanticIntent({
          route: 'clarify',
          confidence: 'low',
          needs_confirmation: true,
          reason_code: 'ambiguous_between_plan_and_build',
          matched_signal: 'semantic_route',
        }, initialIntentContext);
      } finally {
        submitInFlightInstructionRef.current = null;
        publishSubmitInFlight(false);
      }
    }
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
    if (
      submittingAgentWorkbench
      && decision.dispatch === 'build'
    ) {
      publishRouteDecision(decision);
      publishSubmitInFlight(true);
      try {
        const proposalSnapshot = await agentWorkbench.createTaskProposal({
          request_id: `builder-workbench-request:${globalThis.crypto.randomUUID()}`,
          objective: trimmedSubmittedIdea,
          requested_outcome: decision.route === 'plan' ? 'plan' : 'build',
          execution_mode: 'foreground',
          reason: `Agent Workbench delegated the ${decision.route} request to a project Task.`,
        });
        if (proposalSnapshot.status === 'ready') setIdea('');
      } finally {
        publishSubmitInFlight(false);
      }
      return;
    }
    if (decision.dispatch === 'ask_workspace') {
      publishRouteDecision(decision);
      if (
        conversationSnapshotRef.current.agent_id !== null
        && conversationSnapshotRef.current.project_id === null
      ) {
        publishSubmitInFlight(true);
        let proposalCreated = false;
        try {
          const proposalSnapshot = await agentWorkbench.createTaskProposal({
            request_id: `builder-workbench-request:${globalThis.crypto.randomUUID()}`,
            objective: trimmedSubmittedIdea,
            requested_outcome: decision.route === 'plan'
              ? 'plan'
              : (decision.route === 'build' ? 'build' : 'discuss'),
            execution_mode: 'foreground',
            reason: semanticClassification === null
              ? 'The request needs project scope before Builder work can start.'
              : `Semantic routing selected ${decision.route} and requires project scope.`,
          });
          proposalCreated = proposalSnapshot.status === 'ready';
          if (proposalCreated) setIdea('');
        } finally {
          publishSubmitInFlight(false);
        }
        if (proposalCreated) return;
      }
      return;
    }
    if (decision.dispatch === 'ask_permission') {
      const routeEvidence = publishRouteDecision(decision);
      const projectId = visibleConversationProjectId(projectSnapshotRef.current);
      if (projectId !== null) {
        const prompt = Object.freeze({
          composerMode: boundedComposerMode,
          project_id: projectId,
          instruction: submittedIdea,
          message_id: routeEvidence.messageId,
          queuedFollowup: options.queuedFollowup ?? null,
          approvedPlanContinuation: null,
          state: 'pending' as const,
        });
        currentProjectWriteApprovalRef.current = prompt;
        setCurrentProjectWriteApproval(prompt);
        setIdea('');
      }
      return;
    }
    if (submittingAgentWorkbench) {
      publishRouteDecision(decision);
      agentSubmitInFlightRef.current = true;
      setAgentSubmitInFlight(true);
      setIdea('');
      try {
        const request = await createBuilderGenerationRequest(submittedIdea, null);
        agentRequestIdRef.current = request.request_digest;
        const result = await agentConversation.answer(submittedIdea, options.queuedFollowup ?? null,
          boundedComposerMode === 'plan' || decision.dispatch === 'plan' ? 'plan' : 'answer');
        await boundedPostTerminalRefresh(agentWorkbench.refresh(), null);
        if (!agentWorkbenchSelectedRef.current) return;
        const terminalConversation = await boundedPostTerminalRefresh(conversation.refresh(), null);
        if (!agentWorkbenchSelectedRef.current) return;
        const recordedAnswerSuccess = result.status === 'answer_failed'
          && hasRecordedSuccessfulAnswerAfterHead(
            terminalConversation,
            submittedIdea,
            answerStartHeadSequence,
          );
        setAnswerFailureRecordedSuccess(recordedAnswerSuccess);
        if (!recordedAnswerSuccess && !shouldClearSubmittedIdea(result)) {
          setIdea((current) => (current.trim().length === 0 ? submittedIdea : current));
        }
      } finally {
        agentRequestIdRef.current = null;
        agentSubmitInFlightRef.current = false;
        setAgentSubmitInFlight(false);
        agentLiveOutputStore.clear();
        setAgentLiveOutput(null);
      }
      return;
    }
    const commandEpoch = workspaceEpochRef.current;
    submitInFlightInstructionRef.current = submittedIdea;
    publishSubmitInFlight(true);
    try {
      if (boundedComposerMode === 'plan' || decision.dispatch === 'plan') {
        publishRouteDecision(decision);
        const planned = await submitPlanInstruction(
          submittedIdea,
          commandEpoch,
          projectSnapshotRef.current,
        );
        if (planned || boundedComposerMode === 'plan') return;
      }
      if (decision.dispatch === 'build') {
        const projectId = visibleConversationProjectId(projectSnapshotRef.current);
        if (projectId === null) return;
        let approval: BuilderCurrentProjectWriteApprovalStatus;
        try {
          approval = await ports.generator.prepareCurrentProjectWriteApproval({
            project_id: projectId,
            task_address_id: taskAddressId,
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
          const nextIntentContext = composerIntentContext(
            conversationSnapshotRef.current,
            projectSnapshotRef.current,
            boundedComposerMode,
            nextPermissionStatus,
            effectiveApprovalMode(approvalModeRef.current, projectSnapshotRef.current, nextPermissionStatus),
          );
          decision = semanticClassification === null
            ? decideBuilderComposerIntent(submittedIdea, nextIntentContext)
            : decideBuilderComposerSemanticIntent(semanticClassification, nextIntentContext);
          const routeEvidence = publishRouteDecision(
            decision,
            null,
            routeTaskId,
          );
          const prompt = Object.freeze({
            composerMode: boundedComposerMode,
            project_id: projectId,
            instruction: submittedIdea,
            message_id: routeEvidence.messageId,
            queuedFollowup: options.queuedFollowup ?? null,
            approvedPlanContinuation: null,
            state: 'pending' as const,
          });
          currentProjectWriteApprovalRef.current = prompt;
          setCurrentProjectWriteApproval(prompt);
          setIdea('');
          return;
        }
        currentProjectWriteApprovalRef.current = null;
        setCurrentProjectWriteApproval(null);
        const nextIntentContext = composerIntentContext(
          conversationSnapshotRef.current,
          projectSnapshotRef.current,
          boundedComposerMode,
          nextPermissionStatus,
          effectiveApprovalMode(approvalModeRef.current, projectSnapshotRef.current, nextPermissionStatus),
        );
        decision = semanticClassification === null
          ? decideBuilderComposerIntent(submittedIdea, nextIntentContext)
          : decideBuilderComposerSemanticIntent(semanticClassification, nextIntentContext);
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
        ? await runBuildInstruction(
          submittedIdea,
          boundedComposerMode,
          options.queuedFollowup ?? null,
        )
        : await project.answer(submittedIdea, options.queuedFollowup ?? null);
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
      if (!recordedAnswerSuccess && !shouldClearSubmittedIdea(result, terminalConversation)) {
        setIdea((current) => (current.trim().length === 0 ? submittedIdea : current));
      }
      setLiveOutput(null);
    } finally {
      if (workspaceEpochRef.current === commandEpoch) {
        submitInFlightInstructionRef.current = null;
        publishSubmitInFlight(false);
      }
    }
  }, [
    agentConversation,
    agentLiveOutputStore,
    agentWorkbench,
    conversation,
    clearPendingProjectActivityRestore,
    project,
    ports.generator,
    createComposerRouteEvidence,
    publishPendingUserMessage,
    publishQueuedActiveRunFollowup,
    publishLockedComposerSubmit,
    publishSubmitInFlight,
    readActivityAfterTerminal,
    runBuildInstruction,
    reviewPlan,
    submitPlanInstruction,
    taskAddressId,
  ]);

  useLayoutEffect(() => {
    submitInstructionTextRef.current = submitInstructionText;
  }, [submitInstructionText]);

  useEffect(() => {
    const pending = pendingAgentTaskHandoffStartRef.current;
    if (
      pending === null
      || pending.epoch !== workspaceEpoch
      || pending.projectId !== projectId
      || pending.taskAddressId !== taskAddressId
      || conversation.snapshot.project_id !== pending.projectId
      || conversation.snapshot.task_address_id !== pending.taskAddressId
      || submitInFlight
      || project.snapshot.busy
      || project.snapshot.draft !== null
      || project.snapshot.inspectedRevision !== null
      || !['ready', 'selected', 'new'].includes(project.snapshot.status)
      || submitInstructionTextRef.current === null
    ) return;
    pendingAgentTaskHandoffStartRef.current = null;
    const startMaterializedTask = async () => {
      if (pending.autoApproveCurrentProjectWrite) {
        publishSubmitInFlight(true);
        try {
          await ports.generator.approveCurrentProjectWrite({
            project_id: pending.projectId,
            task_address_id: pending.taskAddressId,
          });
          if (
            workspaceEpochRef.current !== pending.epoch
            || projectId !== pending.projectId
            || taskAddressId !== pending.taskAddressId
          ) return;
          const allowed = Object.freeze({
            project_id: pending.projectId,
            state: 'ready' as const,
          });
          currentProjectWriteApprovalStatusRef.current = allowed;
          setCurrentProjectWriteApprovalStatus(allowed);
          currentProjectWriteApprovalRef.current = null;
          setCurrentProjectWriteApproval(null);
        } finally {
          if (workspaceEpochRef.current === pending.epoch) {
            publishSubmitInFlight(false);
          }
        }
      }
      if (
        workspaceEpochRef.current !== pending.epoch
        || projectId !== pending.projectId
        || taskAddressId !== pending.taskAddressId
      ) return;
      await submitInstructionTextRef.current?.(pending.instruction, {
        composerModeOverride: pending.composerMode,
        existingMessageId: pending.messageId,
        queuedFollowup: null,
      });
    };
    void startMaterializedTask();
  }, [
    conversation.snapshot,
    ports.generator,
    project.snapshot,
    projectId,
    publishSubmitInFlight,
    submitInFlight,
    taskAddressId,
    workspaceEpoch,
  ]);

  const submitInstruction = useCallback(async () => {
    if (projectSnapshotRef.current.busy) {
      const currentSnapshot = projectSnapshotRef.current;
      const submittedIdea = idea;
      if (submittedIdea.trim().length === 0) return;
      if (activeRunWaitsForUserAnswer(conversationSnapshotRef.current)) {
        await steerInstruction();
        return;
      }
      const decision = decideBuilderComposerIntent(
        submittedIdea,
        {
          ...composerIntentContext(
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
          activeRunCanQueueFollowup: true,
          activeRunCanSteer: false,
          activeRunStatus: currentSnapshot.status === 'answering' ? 'answering' : 'working',
        },
      );
      const routeEvidence = createComposerRouteEvidence(
        decision,
        currentSnapshot,
        null,
        null,
      );
      setComposerRouteDecision(routeEvidence);
      if (decision.dispatch === 'cancel') {
        const commandEpoch = workspaceEpochRef.current;
        setIdea('');
        const result = await activeConversation.cancel();
        if (workspaceEpochRef.current !== commandEpoch) return;
        await readActivityAfterTerminal(result, commandEpoch);
        setLiveOutput(null);
        return;
      }
      if (decision.dispatch === 'steer') {
        await steerInstruction();
        return;
      }
      if (decision.dispatch === 'queue_followup') {
        await queueActiveRunFollowupInstruction(submittedIdea, routeEvidence);
        return;
      }
      if (decision.dispatch === 'reply') {
        return;
      }
      await queueActiveRunFollowupInstruction(submittedIdea, routeEvidence);
      return;
    }
    await submitInstructionText(idea);
  }, [
    idea,
    activeConversation,
    createComposerRouteEvidence,
    queueActiveRunFollowupInstruction,
    readActivityAfterTerminal,
    steerInstruction,
    submitInstructionText,
  ]);

  const changeComposerInstruction = useCallback((value: string) => {
    setIdea(value);
  }, []);

  const selectComposerMode = useCallback((mode: BuilderComposerMode) => {
    composerModeRef.current = mode;
    if (agentWorkbenchSelectedRef.current) agentComposerModeRef.current = mode;
    setComposerMode(mode);
  }, []);

  const selectPlanMode = useCallback(() => {
    selectComposerMode('plan');
  }, [selectComposerMode]);

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
      await ports.generator.approveCurrentProjectWrite({
        project_id: projectId,
        task_address_id: taskAddressId,
      });
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
        if (prompt.approvedPlanContinuation !== null) {
          setIdea('');
          publishSubmitInFlight(true);
          try {
            await continueApprovedPlanAfterWriteApproval(prompt.approvedPlanContinuation, workspaceEpochRef.current);
          } finally {
            publishSubmitInFlight(false);
          }
          return;
        }
        setIdea('');
        void submitInstructionTextRef.current?.(prompt.instruction, {
          composerModeOverride: prompt.composerMode,
          existingMessageId: prompt.message_id,
          queuedFollowup: prompt.queuedFollowup,
        });
      }
    } catch {
      approvalModeRef.current = 'ask_before_write';
      setApprovalMode('ask_before_write');
    }
  }, [
    continueApprovedPlanAfterWriteApproval,
    ports.generator,
    publishSubmitInFlight,
    taskAddressId,
  ]);

  const composerModelSelection = useMemo<BuilderComposerModelSelection>(() => Object.freeze({
    configDigest: providerSettingsCurrent?.config?.config_digest ?? null,
    model: providerSettingsCurrent?.config?.model ?? null,
    status: providerSettingsState,
  }), [providerSettingsCurrent, providerSettingsState]);

  const selectComposerModel = useCallback(async (model: string, expectedConfigDigest: string) => {
    setProviderSettingsState('selecting');
    try {
      const current = await ports.providerSettings.selectModel({
        model,
        expected_config_digest: expectedConfigDigest,
      });
      setProviderSettingsCurrent(current);
      setProviderSettingsState(current.configured ? 'ready' : 'unconfigured');
    } catch {
      try {
        const current = await ports.providerSettings.readCurrent();
        setProviderSettingsCurrent(current);
        setProviderSettingsState(current.configured ? 'ready' : 'unconfigured');
      } catch {
        setProviderSettingsState('failed');
      }
    }
  }, [ports.providerSettings]);

  const clearComposerMode = useCallback(() => {
    if (agentWorkbenchSelectedRef.current) agentComposerModeRef.current = null;
    composerModeRef.current = null;
    setComposerMode(null);
  }, []);

  const approvePlanSourceRead = useCallback(async () => {
    const prompt = planSourceReadApprovalRef.current;
    if (prompt === null || submitInFlightRef.current || prompt.state === 'approving') return;
    const commandEpoch = workspaceEpochRef.current;
    publishSubmitInFlight(true);
    const approving = Object.freeze({ ...prompt, state: 'approving' as const });
    planSourceReadApprovalRef.current = approving;
    setPlanSourceReadApproval(approving);
    setLiveOutput(null);
    try {
      await ports.generator.approvePlanSourceRead({
        project_id: prompt.project_id,
        task_address_id: taskAddressId,
      });
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
        publishSubmitInFlight(false);
      }
    }
  }, [ports.generator, publishSubmitInFlight, runPlanProposal, taskAddressId]);

  const approveCurrentProjectWrite = useCallback(async () => {
    const prompt = currentProjectWriteApprovalRef.current;
    if (prompt === null || submitInFlightRef.current || prompt.state === 'approving') return;
    const commandEpoch = workspaceEpochRef.current;
    publishSubmitInFlight(true);
    const approving = Object.freeze({ ...prompt, state: 'approving' as const });
    currentProjectWriteApprovalRef.current = approving;
    setCurrentProjectWriteApproval(approving);
    setLiveOutput(null);
    try {
      await ports.generator.approveCurrentProjectWrite({
        project_id: prompt.project_id,
        task_address_id: taskAddressId,
      });
      if (workspaceEpochRef.current !== commandEpoch) return;
      const allowed = Object.freeze({
        project_id: prompt.project_id,
        state: 'ready' as const,
      });
      currentProjectWriteApprovalStatusRef.current = allowed;
      setCurrentProjectWriteApprovalStatus(allowed);
      currentProjectWriteApprovalRef.current = null;
      setCurrentProjectWriteApproval(null);
      if (prompt.approvedPlanContinuation !== null) {
        setIdea('');
        await continueApprovedPlanAfterWriteApproval(prompt.approvedPlanContinuation, commandEpoch);
        return;
      }
      if (prompt.interruptedRunId !== undefined) {
        const result = await project.resumeInterruptedRun(prompt.instruction, prompt.interruptedRunId);
        await readActivityAfterTerminal(result, commandEpoch);
        setLiveOutput(null);
        return;
      }
      const decision = decideBuilderComposerIntent(
        prompt.instruction,
        composerIntentContext(
          conversationSnapshotRef.current,
          projectSnapshotRef.current,
          prompt.composerMode,
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
      const result = await runBuildInstruction(
        prompt.instruction,
        prompt.composerMode,
        prompt.queuedFollowup,
      );
      if (workspaceEpochRef.current !== commandEpoch) return;
      const terminalActivity = await readActivityAfterTerminal(result, commandEpoch);
      if (workspaceEpochRef.current !== commandEpoch) return;
      if (!shouldClearSubmittedIdea(result, terminalActivity)) setIdea(prompt.instruction);
      setLiveOutput(null);
    } catch {
      if (workspaceEpochRef.current === commandEpoch) {
        const failed = Object.freeze({ ...prompt, state: 'failed' as const });
        currentProjectWriteApprovalRef.current = failed;
        setCurrentProjectWriteApproval(failed);
      }
    } finally {
      if (workspaceEpochRef.current === commandEpoch) {
        publishSubmitInFlight(false);
      }
    }
  }, [
    createComposerRouteEvidence,
    continueApprovedPlanAfterWriteApproval,
    project,
    ports.generator,
    publishSubmitInFlight,
    readActivityAfterTerminal,
    runBuildInstruction,
    taskAddressId,
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
    if (prompt.interruptedRunId === undefined) {
      setIdea((current) => (current.trim().length === 0 ? prompt.instruction : current));
    }
  }, []);

  const decideCommandApproval = useCallback(async (decision: 'allow_once' | 'deny') => {
    const prompt = commandApprovalRef.current;
    if (prompt === null || prompt.state === 'deciding') return;
    if (ports.generator.decideCommandApproval === undefined) {
      const failed = Object.freeze({ ...prompt, state: 'failed' as const });
      commandApprovalRef.current = failed;
      setCommandApproval(failed);
      return;
    }
    const deciding = Object.freeze({ ...prompt, state: 'deciding' as const });
    commandApprovalRef.current = deciding;
    setCommandApproval(deciding);
    try {
      commandOutputStore.setState(decision === 'allow_once' ? 'running' : 'denied');
      await ports.generator.decideCommandApproval({
        run_id: prompt.request.run_id,
        approval_request_id: prompt.request.approval_request_id,
        decision,
      });
      if (commandApprovalRef.current?.request.approval_request_id === prompt.request.approval_request_id) {
        commandApprovalRef.current = null;
        setCommandApproval(null);
      }
    } catch {
      commandOutputStore.setState('failed', '无法记录命令授权决定。');
      if (commandApprovalRef.current?.request.approval_request_id === prompt.request.approval_request_id) {
        const failed = Object.freeze({ ...prompt, state: 'failed' as const });
        commandApprovalRef.current = failed;
        setCommandApproval(failed);
      }
    }
  }, [commandOutputStore, ports.generator]);

  const resumeInterruptedRun = useCallback(async () => {
    const snapshot = conversationSnapshotRef.current;
    if (snapshot.status !== 'ready' || snapshot.agent_id !== null
      || projectSnapshotRef.current.busy || projectSnapshotRef.current.draft !== null
      || snapshot.project_id !== visibleConversationProjectId(projectSnapshotRef.current)) return;
    const continuation = interruptedTaskContinuation(snapshot.conversation);
    if (continuation === null || taskAddressId === null || submitInFlightRef.current) return;
    const projectId = visibleConversationProjectId(projectSnapshotRef.current);
    if (projectId === null) return;
    const commandEpoch = workspaceEpochRef.current;
    publishSubmitInFlight(true);
    setLiveOutput(null);
    try {
      const approval = await ports.generator.prepareCurrentProjectWriteApproval({ project_id: projectId, task_address_id: taskAddressId });
      if (workspaceEpochRef.current !== commandEpoch) return;
      if (approval.state !== 'ready') {
        const prompt: BuilderCurrentProjectWriteApprovalPrompt = Object.freeze({
          composerMode: 'build', project_id: projectId, instruction: continuation.instruction,
          message_id: `resume:${continuation.runId}`, queuedFollowup: null, approvedPlanContinuation: null,
          interruptedRunId: continuation.runId, state: 'pending',
        });
        currentProjectWriteApprovalRef.current = prompt;
        setCurrentProjectWriteApproval(prompt);
        return;
      }
      const result = await project.resumeInterruptedRun(continuation.instruction, continuation.runId);
      await readActivityAfterTerminal(result, commandEpoch);
    } catch {
      if (workspaceEpochRef.current === commandEpoch) {
        const prompt: BuilderCurrentProjectWriteApprovalPrompt = Object.freeze({
          composerMode: 'build', project_id: projectId, instruction: continuation.instruction,
          message_id: `resume:${continuation.runId}`, queuedFollowup: null, approvedPlanContinuation: null,
          interruptedRunId: continuation.runId, state: 'failed',
        });
        currentProjectWriteApprovalRef.current = prompt;
        setCurrentProjectWriteApproval(prompt);
      }
    } finally {
      if (workspaceEpochRef.current === commandEpoch) { publishSubmitInFlight(false); setLiveOutput(null); }
    }
  }, [ports.generator, project, publishSubmitInFlight, readActivityAfterTerminal, taskAddressId]);

  const manualCompactContext = useCallback(async () => {
    const snapshot = conversationSnapshotRef.current;
    const projectId = visibleConversationProjectId(projectSnapshotRef.current);
    if (
      agentWorkbenchSelected
      || projectId === null
      || taskAddressId === null
      || snapshot.status !== 'ready'
      || snapshot.agent_id !== null
      || snapshot.project_id !== projectId
      || snapshot.task_address_id !== taskAddressId
      || snapshot.conversation === null
      || snapshot.conversation.state !== 'ready'
      || ports.generator.manualCompactContext === undefined
    ) return;
    setManualContextCompactionFeedback('compacting');
    try {
      const result = await ports.generator.manualCompactContext({
        project_id: projectId,
        conversation_id: snapshot.conversation.conversation.conversation_id,
        task_address_id: taskAddressId,
      });
      setManualContextCompactionFeedback(result.status === 'compaction_completed'
        ? 'compacted'
        : 'not_needed');
      await conversation.load(projectId, taskAddressId).catch(() => undefined);
    } catch {
      setManualContextCompactionFeedback('failed');
    }
  }, [agentWorkbenchSelected, conversation, ports.generator, taskAddressId]);

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

  const [activeAgentTestBrowserRunId, setActiveAgentTestBrowserRunId] = useState<string | null>(null);
  const cancel = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    if (activeAgentTestBrowserRunId !== null) {
      await ports.agentTestBrowser.stop({ owner_run_id: activeAgentTestBrowserRunId }).catch(() => undefined);
    }
    const result = await activeConversation.cancel();
    if (agentWorkbenchSelected) {
      agentLiveOutputStore.clear();
      setAgentLiveOutput(null);
    }
    if (workspaceEpochRef.current !== commandEpoch) return;
    await readActivityAfterTerminal(result, commandEpoch);
    setLiveOutput(null);
  }, [activeAgentTestBrowserRunId, activeConversation, agentLiveOutputStore, agentWorkbenchSelected,
    ports.agentTestBrowser, readActivityAfterTerminal]);

  const pauseTask = useCallback(async () => {
    if (agentWorkbenchSelected) return;
    const commandEpoch = workspaceEpochRef.current;
    if (activeAgentTestBrowserRunId !== null) {
      await ports.agentTestBrowser.stop({ owner_run_id: activeAgentTestBrowserRunId }).catch(() => undefined);
    }
    const result = await project.cancel({ pause: true });
    if (workspaceEpochRef.current !== commandEpoch) return;
    await readActivityAfterTerminal(result, commandEpoch);
    setLiveOutput(null);
  }, [activeAgentTestBrowserRunId, agentWorkbenchSelected, ports.agentTestBrowser, project, readActivityAfterTerminal]);

  const rejectDraft = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    const draftProjectId = project.snapshot.draft?.project_id ?? null;
    if (draftProjectId !== null) {
      automaticDraftRestoreSuppressedProjectIdsRef.current.add(draftProjectId);
    }
    const result = await project.rejectDraft();
    if (workspaceEpochRef.current !== commandEpoch) return;
    if (draftProjectId !== null && (result.draft !== null || result.error !== null)) {
      automaticDraftRestoreSuppressedProjectIdsRef.current.delete(draftProjectId);
    }
    await readActivityAfterTerminal(result, commandEpoch, draftProjectId);
    setLiveOutput(null);
  }, [project, readActivityAfterTerminal]);

  const undoDraft = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    const draftProjectId = project.snapshot.draft?.project_id ?? null;
    const result = await project.restorePreviousCheckpointAsDraft();
    if (workspaceEpochRef.current !== commandEpoch) return;
    await readActivityAfterTerminal(result, commandEpoch, draftProjectId);
    setLiveOutput(null);
  }, [project, readActivityAfterTerminal]);

  const save = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    const draftProjectId = project.snapshot.draft?.project_id ?? null;
    if (draftProjectId !== null) {
      automaticDraftRestoreSuppressedProjectIdsRef.current.add(draftProjectId);
    }
    const result = await project.save();
    if (workspaceEpochRef.current !== commandEpoch) return;
    const savedProjectId = durableProjectId(result);
    if (savedProjectId === null && draftProjectId !== null) {
      automaticDraftRestoreSuppressedProjectIdsRef.current.delete(draftProjectId);
    }
    await readActivityAfterTerminal(result, commandEpoch);
    setLiveOutput(null);
    if (savedProjectId !== null) {
      setProjectId(savedProjectId);
      await Promise.all([
        catalog.refresh().catch(() => undefined),
        agentProjectTree.refresh().catch(() => undefined),
      ]);
      if (history.snapshot.project_id === savedProjectId) {
        await history.reload().catch(() => undefined);
      } else {
        await history.load(savedProjectId).catch(() => undefined);
      }
    }
  }, [agentProjectTree, catalog, history, project, readActivityAfterTerminal]);
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
  const composerProviderContextStatus = composerProviderContextDisclosureStatus(
    conversation.snapshot,
    project.snapshot,
  );
  const composerContextUsageProjection =
    conversation.snapshot.conversation?.context_usage_projection ?? null;
  const visibleProviderContextDisclosureApprovalState =
    composerProviderContextStatus?.needs_user_approval === true
      ? providerContextDisclosureApprovalState
      : 'idle';

  const approveProviderContextDisclosure = useCallback(async () => {
    const conversationSnapshot = conversation.snapshot;
    const providerContextStatus = composerProviderContextStatus;
    if (
      providerContextDisclosureApproval === null
      || providerContextStatus === null
      || providerContextStatus.needs_user_approval !== true
      || providerContextStatus.request_available !== true
      || conversationSnapshot.project_id === null
      || conversationSnapshot.conversation === null
      || conversationSnapshot.conversation.conversation === null
    ) return;
    setProviderContextDisclosureApprovalState('approving');
    try {
      await providerContextDisclosureApproval.approveCurrent({
        project_id: conversationSnapshot.project_id,
        conversation_id: conversationSnapshot.conversation.conversation.conversation_id,
      });
      setProviderContextDisclosureApprovalState('idle');
      await conversation.refresh();
    } catch {
      setProviderContextDisclosureApprovalState('failed');
    }
  }, [
    composerProviderContextStatus,
    conversation,
    providerContextDisclosureApproval,
  ]);

  const livePreviewProjectId = conversation.snapshot.project_id;
  const livePreviewConversationId = conversation.snapshot.conversation?.state === 'ready'
    ? conversation.snapshot.conversation.conversation.conversation_id
    : null;
  const livePreviewRequest = useCallback((): BuilderLivePreviewRequest | null => {
    if (
      livePreviewProjectId === null
      || livePreviewConversationId === null
    ) return null;
    return Object.freeze({
      project_id: livePreviewProjectId,
      conversation_id: livePreviewConversationId,
    });
  }, [livePreviewConversationId, livePreviewProjectId]);

  const runLivePreviewOperation = useCallback(async (
    operation: 'starting' | 'reloading' | 'stopping',
    action: (request: BuilderLivePreviewRequest) => Promise<BuilderLivePreviewStatusProjection>,
  ) => {
    const request = livePreviewRequest();
    if (request === null) return;
    const version = ++livePreviewResponseVersion.current;
    setLivePreviewOperation(operation);
    try {
      const status = await action(request);
      if (version === livePreviewResponseVersion.current) setLivePreviewStatus(status);
    } catch {
      if (version === livePreviewResponseVersion.current) setLivePreviewStatus(null);
    } finally {
      if (version === livePreviewResponseVersion.current) setLivePreviewOperation(null);
    }
  }, [livePreviewRequest]);

  const requestLivePreview = useCallback(() => runLivePreviewOperation(
    'starting',
    ports.livePreview.requestCurrentDraftPreview,
  ), [ports.livePreview, runLivePreviewOperation]);

  const reloadLivePreview = useCallback(() => runLivePreviewOperation(
    'reloading',
    ports.livePreview.reloadCurrentPreview,
  ), [ports.livePreview, runLivePreviewOperation]);

  const stopLivePreview = useCallback(() => runLivePreviewOperation(
    'stopping',
    ports.livePreview.stopCurrentPreview,
  ), [ports.livePreview, runLivePreviewOperation]);

  const decideLivePreviewDevServerApproval = useCallback(async (
    decision: 'allow_once' | 'deny',
  ) => {
    const request = livePreviewRequest();
    const approval = livePreviewStatus?.status === 'approval_required'
      ? livePreviewStatus.dev_server_approval
      : null;
    if (
      request === null
      || approval === null
      || approval.project_id !== request.project_id
      || approval.conversation_id !== request.conversation_id
    ) return;
    await runLivePreviewOperation(decision === 'allow_once' ? 'starting' : 'stopping',
      (currentRequest) => ports.livePreview.decideDevServerApproval({
        ...currentRequest,
        approval_request_id: approval.approval_request_id,
        decision,
      }));
  }, [livePreviewRequest, livePreviewStatus, ports.livePreview, runLivePreviewOperation]);

  const updateLivePreviewLayout = useCallback((viewBounds: BuilderLivePreviewViewBounds | null) => {
    const request = livePreviewRequest();
    if (request === null) return;
    void ports.livePreview.updateCurrentPreviewLayout({
      ...request,
      view_bounds: viewBounds,
    }).catch(() => {
      // Layout synchronization is best-effort; preview status remains authoritative.
    });
  }, [livePreviewRequest, ports.livePreview]);

  useEffect(() => {
    const version = ++livePreviewResponseVersion.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Preview selection changes invalidate the prior operation immediately.
    setLivePreviewOperation(null);
    const request = livePreviewRequest();
    if (request === null) return;
    let active = true;
    ports.livePreview.readCurrentPreviewStatus(request)
      .then((status) => {
        if (active && version === livePreviewResponseVersion.current) setLivePreviewStatus(status);
      })
      .catch(() => {
        if (active && version === livePreviewResponseVersion.current) setLivePreviewStatus(null);
      });
    return () => {
      active = false;
    };
  }, [livePreviewRequest, ports.livePreview]);
  const hasVisibleLivePreviewRequest = conversation.snapshot.project_id !== null
    && conversation.snapshot.conversation !== null
    && conversation.snapshot.conversation.state === 'ready';
  const visibleLivePreviewStatus = hasVisibleLivePreviewRequest
    && livePreviewStatus?.project_id === livePreviewProjectId
    && livePreviewStatus?.conversation_id === livePreviewConversationId ? livePreviewStatus : null;

  const runUserWebOperation = useCallback(async (
    operation: 'navigating' | 'reloading' | 'stopping',
    action: () => Promise<BuilderUserWebStatusProjection>,
  ) => {
    setUserWebOperation(operation);
    try {
      setUserWebStatus(await action());
    } catch {
      setUserWebStatus(null);
    } finally {
      setUserWebOperation(null);
    }
  }, []);

  const navigateUserWeb = useCallback((url: string) => runUserWebOperation(
    'navigating',
    () => ports.userWeb.navigate({ url }),
  ), [ports.userWeb, runUserWebOperation]);
  const goBackUserWeb = useCallback(() => runUserWebOperation(
    'navigating',
    ports.userWeb.goBack,
  ), [ports.userWeb, runUserWebOperation]);
  const goForwardUserWeb = useCallback(() => runUserWebOperation(
    'navigating',
    ports.userWeb.goForward,
  ), [ports.userWeb, runUserWebOperation]);
  const reloadUserWeb = useCallback(() => runUserWebOperation(
    'reloading',
    ports.userWeb.reload,
  ), [ports.userWeb, runUserWebOperation]);
  const stopUserWeb = useCallback(() => runUserWebOperation(
    'stopping',
    ports.userWeb.stop,
  ), [ports.userWeb, runUserWebOperation]);
  const updateUserWebLayout = useCallback((viewBounds: BuilderLivePreviewViewBounds | null) => {
    void ports.userWeb.updateLayout({ view_bounds: viewBounds }).catch(() => {
      // Main remains authoritative; a later layout observation will retry.
    });
  }, [ports.userWeb]);
  const updateAgentTestBrowserLayout = useCallback((
    ownerRunId: string,
    viewBounds: BuilderLivePreviewViewBounds | null,
  ) => {
    void ports.agentTestBrowser.updateLayout({
      owner_run_id: ownerRunId,
      view_bounds: viewBounds,
    }).catch(() => {
      // Main validates the active run; later geometry observations retry safely.
    });
  }, [ports.agentTestBrowser]);
  useEffect(() => ports.agentTestBrowser.subscribeLifecycle((event) => {
    setActiveAgentTestBrowserRunId((current) => (
      event.lifecycle === 'opened'
        ? event.owner_run_id
        : current === event.owner_run_id
          ? null
          : current
    ));
  }), [ports.agentTestBrowser]);

  useEffect(() => {
    let active = true;
    ports.userWeb.readStatus()
      .then((status) => {
        if (active) setUserWebStatus(status);
      })
      .catch(() => {
        if (active) setUserWebStatus(null);
      });
    return () => { active = false; };
  }, [ports.userWeb]);
  const runtimeSideWorkspaceKeyPrefix = conversation.snapshot.project_id !== null
    && conversation.snapshot.conversation?.state === 'ready'
    ? `runtime:${conversation.snapshot.project_id}:${conversation.snapshot.conversation.conversation.conversation_id}:`
    : null;
  const runtimeSideWorkspaceVisible = runtimeSideWorkspaceKeyPrefix !== null
    && sideWorkspaceFileTreeKey?.startsWith(runtimeSideWorkspaceKeyPrefix) === true;
  const visibleSideWorkspaceFileTree = runtimeSideWorkspaceVisible
    || sideWorkspaceFileTreeKey === currentSideWorkspaceFilesRequestKey
    ? sideWorkspaceFileTree
    : null;
  const visibleSideWorkspaceFileTreeStatus = runtimeSideWorkspaceVisible
    || (currentSideWorkspaceFilesRequestKey !== null
      && sideWorkspaceFileTreeKey === currentSideWorkspaceFilesRequestKey)
    ? sideWorkspaceFileTreeStatus
    : 'idle';
  const visibleSideWorkspaceFileContentKey = visibleSideWorkspaceFileTree !== null
    && sideWorkspaceSelectedFileRef !== null
    && conversation.snapshot.project_id !== null
    && conversation.snapshot.conversation?.state === 'ready'
    ? `${conversation.snapshot.project_id}:${conversation.snapshot.conversation.conversation.conversation_id}:${sideWorkspaceFileRefKey(sideWorkspaceSelectedFileRef)}`
    : null;
  const visibleSideWorkspaceFileContent = sideWorkspaceFileContentKey === visibleSideWorkspaceFileContentKey
    ? sideWorkspaceFileContent
    : null;
  const visibleSideWorkspaceFileContentStatus = visibleSideWorkspaceFileContentKey !== null
    && sideWorkspaceFileContentKey === visibleSideWorkspaceFileContentKey
    ? sideWorkspaceFileContentStatus
    : 'idle';
  const currentDraftCheckProfiles = checkRunAvailable?.draft_id === currentDraftId
    ? checkRunAvailable.available_checks
    : [];
  const settingsDiagnosisProfile = currentDraftCheckProfiles[0] ?? null;

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

      <div
        className="cf-builder-shell"
        data-builder-projects={projectsVisibility}
        data-builder-view={view}
      >
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

        <aside
          aria-label="Agents"
          className="cf-builder-agent-roster-column"
          data-builder-workbench-agent-roster="true"
        >
          <BuilderAgentRoster
            agentConversationSelected={agentWorkbenchSelected}
            onCreateProject={startNewProjectFromCatalog}
            onOpenAgent={openAgentWorkbench}
            onToggleProjects={() => setProjectsCollapsed((current) => !current)}
            projectCount={projectCount}
            projectsExpanded={projectsExpanded}
            snapshot={agentProjectTree.snapshot}
          />
        </aside>

        {projectsExpanded ? (
          <aside className="cf-builder-context cf-builder-context-sidebar" aria-label="Builder navigation" data-builder-workbench-context="true">
            <div className="cf-builder-context-body">
              <BuilderAgentSidebar
                exportTranscriptFeedback={taskTranscriptExportFeedback}
                onArchiveProject={archiveAgentProject}
                onArchiveTask={archiveAgentTask}
                onCollapse={() => setProjectsCollapsed(true)}
                onCreateProject={startNewProjectFromCatalog}
                onCreateTask={startNewTask}
                onExportTaskTranscript={exportAgentTaskTranscript}
                onOpenProject={openProject}
                onOpenTask={openTask}
                onRefresh={refreshCatalog}
                onRenameProject={renameAgentProject}
                onRenameTask={renameAgentTask}
                selectedProjectId={agentWorkbenchSelected ? null : visibleConversationProjectId(project.snapshot)}
                selectedTaskAddressId={taskAddressId}
                snapshot={agentProjectTree.snapshot}
                taskMonitor={agentWorkbench.snapshot.projection?.task_monitor.tasks ?? []}
              />
            </div>
          </aside>
        ) : null}

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
                <BuilderEnvironmentDiagnosisSettingsCard
                  currentDraftId={currentDraftId}
                  diagnosis={checkEnvironmentDiagnosis}
                  projectDiagnosis={projectEnvironmentDiagnosis}
                  projectId={projectId ?? null}
                  onDiagnose={diagnoseCheckEnvironment}
                  onDiagnoseProject={diagnoseProjectEnvironment}
                  onPrepareDependencies={decideCheckDependencyPreparation}
                  operation={currentDraftId === null ? null : checkRunOperation}
                  operationFailureCode={currentDraftId === null ? null : checkRunOperationFailureCode}
                  profile={settingsDiagnosisProfile}
                />
                <BuilderProviderSettingsRouteAdapter providerSettingsBridge={root.providerSettings} />
              </div>
            </div>
          ) : (
            <BuilderPage
              activeRunFollowupQueued={queuedActiveRunFollowup !== null
                && activeConversation.snapshot.busy}
              activeFile={activeFile}
              answerFailureRecordedSuccess={answerFailureRecordedSuccess}
              approvalMode={visibleApprovalMode}
              approvedPlanContinuationFailure={approvedPlanContinuationFailure}
              checkEnvironmentDiagnosis={checkEnvironmentDiagnosis}
              checkRunOperation={currentDraftId === null ? null : checkRunOperation}
              checkRunOperationFailureCode={currentDraftId === null ? null : checkRunOperationFailureCode}
              checkRunProfiles={currentDraftCheckProfiles}
              checkRunStatus={null}
              projectDependencyPreparation={projectDependencyPreparation}
              projectEnvironmentDiagnosis={projectEnvironmentDiagnosis}
              composerContextStatus={composerContextStatus}
              providerContextDisclosureStatus={composerProviderContextStatus}
              contextUsageProjection={composerContextUsageProjection}
              manualContextCompactionFeedback={manualContextCompactionFeedback}
              onManualCompactContext={ports.generator.manualCompactContext === undefined
                ? undefined
                : manualCompactContext}
              onPrepareProjectDependencies={prepareProjectDependencies}
              providerContextDisclosureApprovalState={visibleProviderContextDisclosureApprovalState}
              composerMode={composerMode}
              composerModelSelection={composerModelSelection}
              composerRouteDecision={composerRouteDecision}
              composerSubmitLocked={submitInFlight || (agentWorkbenchSelected && agentSubmitInFlight)}
              commandApproval={commandApproval}
              commandOutputStore={commandOutputStore}
              currentProjectWriteApproval={currentProjectWriteApproval}
              instruction={idea}
              liveOutput={agentWorkbenchSelected ? agentLiveOutput : liveOutput}
              liveOutputStore={agentWorkbenchSelected ? agentLiveOutputStore : liveOutputStore}
              pendingUserMessages={pendingUserMessages}
              livePreviewOperation={livePreviewOperation}
              livePreviewStatus={visibleLivePreviewStatus}
              userWebOperation={userWebOperation}
              userWebStatus={userWebStatus}
              sideWorkspaceFileContent={visibleSideWorkspaceFileContent}
              sideWorkspaceFileContentStatus={visibleSideWorkspaceFileContentStatus}
              sideWorkspaceFileTree={visibleSideWorkspaceFileTree}
              sideWorkspaceFileTreeStatus={visibleSideWorkspaceFileTreeStatus}
              surfaceKind={agentWorkbenchSelected ? 'workbench' : 'task'}
              planReviewFailure={planReviewFailure}
              planReviewInFlight={planReviewInFlight}
              planReviewRecorded={planReviewRecorded}
              planSourceReadApproval={planSourceReadApproval}
              onApproveCurrentProjectWrite={approveCurrentProjectWrite}
              onDecideCommandApproval={decideCommandApproval}
              onDecideCheckDependencyPreparation={decideCheckDependencyPreparation}
              onDiagnoseCheckEnvironment={diagnoseCheckEnvironment}
              onApproveProviderContextDisclosure={approveProviderContextDisclosure}
              onApprovePlanSourceRead={approvePlanSourceRead}
              onClearComposerMode={clearComposerMode}
              onDismissCurrentProjectWriteApproval={dismissCurrentProjectWriteApproval}
              onDismissPlanSourceReadApproval={dismissPlanSourceReadApproval}
              onSelectApprovalMode={selectApprovalMode}
              onSelectComposerMode={selectComposerMode}
              onSelectComposerModel={selectComposerModel}
              onSelectPlanMode={selectPlanMode}
              onSubmitInstruction={submitInstruction}
              onInstructionChange={changeComposerInstruction}
              onInspectRevision={inspectRevision}
              onOpenProjectLocation={openProjectLocation}
              onOpenSettings={() => setView('settings')}
              onReloadLivePreview={reloadLivePreview}
              onDecideLivePreviewDevServerApproval={decideLivePreviewDevServerApproval}
              onLivePreviewLayoutChange={updateLivePreviewLayout}
              onAgentTestBrowserLayoutChange={updateAgentTestBrowserLayout}
              activeAgentTestBrowserRunId={activeAgentTestBrowserRunId}
              onNavigateUserWeb={navigateUserWeb}
              onGoBackUserWeb={goBackUserWeb}
              onGoForwardUserWeb={goForwardUserWeb}
              onReloadUserWeb={reloadUserWeb}
              onStopUserWeb={stopUserWeb}
              onUserWebLayoutChange={updateUserWebLayout}
              onRestoreRevisionAsDraft={restoreRevisionAsDraft}
              onRetryGenerate={retryGenerate}
              onResumeInterruptedRun={resumeInterruptedRun}
              onRequestLivePreview={requestLivePreview}
              onRequestSideWorkspaceFiles={requestSideWorkspaceFiles}
              onCancel={cancel}
              onPauseTask={pauseTask}
              onRejectDraft={rejectDraft}
              onSave={save}
              onUndoDraft={undoDraft}
              onStopLivePreview={stopLivePreview}
              onSelectFile={selectActiveFile}
              onOpenRuntimeToolFile={openRuntimeToolFile}
              onSelectSideWorkspaceFile={selectSideWorkspaceFile}
              onRefreshConversation={conversation.refresh}
              onRefreshHistory={history.refresh}
              onReviewPlan={reviewPlan}
              onShowCurrentRevision={showCurrentRevision}
              conversationSnapshot={conversation.snapshot}
              taskConversationSeed={selectedTask}
              agentWorkbenchSnapshot={agentWorkbench.snapshot}
              onRefreshAgentWorkbench={agentWorkbench.refresh}
              onUpdateAgentWorkbenchMessageState={agentWorkbench.updateMessageState}
              onDecideAgentTaskProposal={decideAgentTaskProposal}
              onDecideAgentPlan={decideAgentPlan}
              onCreateProjectForAgentTaskProposal={createProjectForAgentTaskProposal}
              onArchiveAgentTask={archiveAgentTask}
              onControlAgentTask={controlAgentTask}
              onOpenAgentTaskProposal={openTask}
              onRenameAgentTask={renameAgentTask}
              projectCatalogSnapshot={catalog.snapshot}
              historySnapshot={history.snapshot}
              snapshot={activeConversation.snapshot}
            />
          )}
        </section>
      </div>
    </main>
  );
}

export { BuilderDesktopBridgeRootError };
