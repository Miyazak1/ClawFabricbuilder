import {
  sanitizeBuilderProjectCatalogResult,
  type BuilderProjectCatalogItem,
} from '../domain/builderProjectCatalog';
import type { BuilderProjectWorkspacePort } from './builderPorts';

export type BuilderProjectCatalogPort = Pick<BuilderProjectWorkspacePort, 'listCurrent'>;

export type BuilderProjectCatalogStatus =
  | 'loading'
  | 'ready'
  | 'refreshing'
  | 'stale'
  | 'unavailable';

export type BuilderProjectCatalogSnapshot = Readonly<{
  status: BuilderProjectCatalogStatus;
  projects: readonly BuilderProjectCatalogItem[];
  busy: boolean;
}>;

export type BuilderProjectCatalogController = Readonly<{
  activate(): void;
  retire(): void;
  getSnapshot(): BuilderProjectCatalogSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<BuilderProjectCatalogSnapshot>;
  refresh(): Promise<BuilderProjectCatalogSnapshot>;
  dispose(): void;
}>;

const TRUSTED_SNAPSHOTS = new WeakSet<object>();
const EMPTY_PROJECTS = Object.freeze([]) as readonly BuilderProjectCatalogItem[];

function snapshot(
  status: BuilderProjectCatalogStatus,
  projects: readonly BuilderProjectCatalogItem[],
): BuilderProjectCatalogSnapshot {
  const result = Object.freeze({
    status,
    projects,
    busy: status === 'loading' || status === 'refreshing',
  });
  TRUSTED_SNAPSHOTS.add(result);
  return result;
}

export function isTrustedBuilderProjectCatalogSnapshot(
  value: unknown,
): value is BuilderProjectCatalogSnapshot {
  return value !== null && typeof value === 'object' && TRUSTED_SNAPSHOTS.has(value);
}

export function createBuilderProjectCatalogController(
  port: BuilderProjectCatalogPort,
): BuilderProjectCatalogController {
  let current = snapshot('loading', EMPTY_PROJECTS);
  let generation = 0;
  let disposed = false;
  let activeAuthority = true;
  let active: Promise<BuilderProjectCatalogSnapshot> | null = null;
  const listeners = new Set<() => void>();

  function publish(next: BuilderProjectCatalogSnapshot): BuilderProjectCatalogSnapshot {
    if (disposed || !activeAuthority) return current;
    current = next;
    for (const listener of Array.from(listeners)) {
      try { listener(); } catch { /* observers cannot interrupt catalog authority */ }
    }
    return current;
  }

  function run(mode: 'load' | 'refresh'): Promise<BuilderProjectCatalogSnapshot> {
    if (disposed || !activeAuthority) return Promise.resolve(current);
    if (active) return active;
    const operationGeneration = ++generation;
    const retained = current.projects;
    const retainsSnapshot = mode === 'refresh' && (current.status === 'ready' || current.status === 'stale');
    publish(snapshot(retainsSnapshot ? 'refreshing' : 'loading', retained));
    const running = Promise.resolve()
      .then(() => port.listCurrent())
      .then((raw) => (
        disposed || !activeAuthority || operationGeneration !== generation
          ? null
          : sanitizeBuilderProjectCatalogResult(raw)
      ))
      .then((result) => (
        result === null || disposed || !activeAuthority || operationGeneration !== generation
          ? current
          : publish(snapshot('ready', result.projects))
      ))
      .catch(() => {
        if (disposed || !activeAuthority || operationGeneration !== generation) return current;
        return publish(snapshot(retainsSnapshot ? 'stale' : 'unavailable', retained));
      });
    active = running;
    void running.finally(() => {
      if (active === running) active = null;
    }).catch(() => undefined);
    return running;
  }

  return Object.freeze({
    activate() { if (!disposed) activeAuthority = true; },
    retire() { activeAuthority = false; },
    getSnapshot: () => current,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load() {
      if (current.status === 'ready' || current.status === 'stale') return Promise.resolve(current);
      return run('load');
    },
    refresh() { return run('refresh'); },
    dispose() {
      if (disposed) return;
      disposed = true;
      activeAuthority = false;
      generation += 1;
      listeners.clear();
    },
  });
}
