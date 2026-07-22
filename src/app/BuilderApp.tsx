import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { BuilderProjectCatalogPort } from '../features/builder/application/builderProjectCatalogController';
import type { BuilderCodeGeneratorPort, BuilderProjectRepositoryPort } from '../features/builder/application/builderPorts';
import { BuilderDesktopCodeGeneratorPortError, createBuilderDesktopCodeGeneratorPort } from '../features/builder/infrastructure/builderDesktopCodeGeneratorPort';
import { BuilderDesktopProjectCatalogPortError, createBuilderDesktopProjectCatalogPort } from '../features/builder/infrastructure/builderDesktopProjectCatalogPort';
import { BuilderDesktopRepositoryPortError, createBuilderDesktopRepositoryPort } from '../features/builder/infrastructure/builderDesktopRepositoryPort';
import { useBuilderProjectCatalogController } from '../features/builder/hooks/useBuilderProjectCatalogController';
import { useBuilderProjectController } from '../features/builder/hooks/useBuilderProjectController';
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

const UNAVAILABLE_ROOT: BuilderDesktopBridgeRoot = Object.freeze({
  bridgeVersion: 'builder-preload.v0',
  codeGenerator: null,
  projectCatalog: null,
  projectRevisions: null,
  providerSettings: null,
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

const UNAVAILABLE_REPOSITORY: BuilderProjectRepositoryPort = Object.freeze({
  commit(request: Parameters<BuilderProjectRepositoryPort['commit']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopRepositoryPortError());
  },
  loadCurrent(request: Parameters<BuilderProjectRepositoryPort['loadCurrent']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopRepositoryPortError());
  },
});

const UNAVAILABLE_CATALOG: BuilderProjectCatalogPort = Object.freeze({
  listCurrent() {
    return Promise.reject(new BuilderDesktopProjectCatalogPortError());
  },
});

const UNAVAILABLE_GENERATOR: BuilderCodeGeneratorPort = Object.freeze({
  generate(request: Parameters<BuilderCodeGeneratorPort['generate']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
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
  let repository = UNAVAILABLE_REPOSITORY;
  let catalog = UNAVAILABLE_CATALOG;
  let generator = UNAVAILABLE_GENERATOR;
  try {
    repository = createBuilderDesktopRepositoryPort(root.projectRevisions);
  } catch {
    repository = UNAVAILABLE_REPOSITORY;
  }
  try {
    catalog = createBuilderDesktopProjectCatalogPort(root.projectCatalog);
  } catch {
    catalog = UNAVAILABLE_CATALOG;
  }
  try {
    generator = createBuilderDesktopCodeGeneratorPort(root.codeGenerator);
  } catch {
    generator = UNAVAILABLE_GENERATOR;
  }
  return Object.freeze({ catalog, generator, repository });
}

function durableProjectId(snapshot: ReturnType<typeof useBuilderProjectController>['snapshot']): string | null {
  if (
    snapshot.savedRevision !== null
    && (snapshot.status === 'ready' || snapshot.status === 'preview_unavailable')
  ) return snapshot.savedRevision.project_id;
  return null;
}

export function BuilderApp({ bridgeRoot }: BuilderAppProps) {
  const root = useMemo(() => safeRoot(bridgeRoot), [bridgeRoot]);
  const ports = useMemo(() => safePorts(root), [root]);
  const windowControls = useMemo(() => safeWindowControls(root.windowControls), [root]);
  const catalog = useBuilderProjectCatalogController(ports.catalog);
  const [view, setView] = useState<BuilderAppView>('project');
  const [projectId, setProjectId] = useState<string | undefined>();
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [idea, setIdea] = useState('');
  const [activeFile, setActiveFile] = useState<BuilderFileName>('index.html');
  const [windowMaximized, setWindowMaximized] = useState(false);
  const workspaceEpochRef = useRef(0);
  const windowMaximizedRef = useRef(false);
  const workspacePorts = useMemo(() => {
    void workspaceEpoch;
    const generator: BuilderCodeGeneratorPort = Object.freeze({
      generate(request: Parameters<BuilderCodeGeneratorPort['generate']>[0]) {
        return ports.generator.generate(request);
      },
    });
    const repository: BuilderProjectRepositoryPort = Object.freeze({
      commit(request: Parameters<BuilderProjectRepositoryPort['commit']>[0]) {
        return ports.repository.commit(request);
      },
      loadCurrent(request: Parameters<BuilderProjectRepositoryPort['loadCurrent']>[0]) {
        return ports.repository.loadCurrent(request);
      },
    });
    return Object.freeze({ generator, repository });
  }, [ports, workspaceEpoch]);
  const project = useBuilderProjectController({
    generator: workspacePorts.generator,
    repository: workspacePorts.repository,
    projectId,
  });

  const resetWorkspace = useCallback((nextProjectId: string | undefined) => {
    workspaceEpochRef.current += 1;
    setWorkspaceEpoch(workspaceEpochRef.current);
    setProjectId(nextProjectId);
    setIdea('');
    setActiveFile('index.html');
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

  const generate = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    const result = await project.generate(idea);
    if (workspaceEpochRef.current !== commandEpoch) return;
    if (durableProjectId(result) !== null) {
      await catalog.refresh().catch(() => undefined);
    }
  }, [catalog, idea, project]);

  const retrySave = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    const result = await project.retrySave();
    if (workspaceEpochRef.current !== commandEpoch) return;
    if (durableProjectId(result) !== null) {
      await catalog.refresh().catch(() => undefined);
    }
  }, [catalog, project]);
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
              idea={idea}
              onGenerate={generate}
              onIdeaChange={setIdea}
              onOpenSettings={() => setView('settings')}
              onRetrySave={retrySave}
              onSelectFile={setActiveFile}
              snapshot={project.snapshot}
            />
          )}
        </section>
      </div>
    </main>
  );
}

export { BuilderDesktopBridgeRootError };
