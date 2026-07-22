import { useCallback, useMemo, useRef, useState } from 'react';
import { Code2, Settings } from 'lucide-react';

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

const UNAVAILABLE_ROOT: BuilderDesktopBridgeRoot = Object.freeze({
  bridgeVersion: 'builder-preload.v0',
  codeGenerator: null,
  projectCatalog: null,
  projectRevisions: null,
  providerSettings: null,
});

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
  const catalog = useBuilderProjectCatalogController(ports.catalog);
  const [view, setView] = useState<BuilderAppView>('project');
  const [projectId, setProjectId] = useState<string | undefined>();
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [idea, setIdea] = useState('');
  const [activeFile, setActiveFile] = useState<BuilderFileName>('index.html');
  const workspaceEpochRef = useRef(0);
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

  return (
    <main className="cf-builder-workbench grid min-h-screen grid-cols-1 text-foreground lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="cf-builder-context flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r" aria-label="Builder navigation">
        <header className="cf-builder-header flex min-h-14 items-center gap-3 border-b px-4">
          <span className="cf-builder-brand-mark inline-flex size-8 items-center justify-center">
            <Code2 aria-hidden="true" className="size-4" />
          </span>
          <strong className="text-sm">ClawFabric Builder</strong>
        </header>
        <div className="flex gap-2 border-b p-3">
          <button
            aria-pressed={view === 'settings'}
            className="cf-builder-nav-button inline-flex min-h-10 flex-1 items-center justify-center gap-2 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setView('settings')}
            type="button"
          >
            <Settings aria-hidden="true" className="size-4" />
            Settings
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <BuilderProjectCatalog
            onCreateProject={newProject}
            onOpenProject={openProject}
            onRefresh={refreshCatalog}
            snapshot={catalog.snapshot}
          />
        </div>
      </aside>

      <section className="cf-builder-main-frame min-w-0 lg:border-l" aria-label="Builder workspace">
        {view === 'settings' ? (
          <div className="flex min-h-screen flex-col bg-background text-foreground">
            <header className="cf-builder-header flex min-h-14 items-center justify-between gap-4 border-b px-4">
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
            <BuilderProviderSettingsRouteAdapter providerSettingsBridge={root.providerSettings} />
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
    </main>
  );
}

export { BuilderDesktopBridgeRootError };
