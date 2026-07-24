import type { BuilderProjectWorkspacePort } from './builderPorts';
import {
  BUILDER_PROJECT_HISTORY_LIMIT,
  sanitizeBuilderProjectHistoryResult,
  type BuilderProjectHistoryResult,
} from '../domain/builderProjectHistory';

export type BuilderProjectHistoryPort = Pick<BuilderProjectWorkspacePort, 'listHistory'>;

export type BuilderProjectHistoryStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'refreshing'
  | 'stale'
  | 'unavailable';

export type BuilderProjectHistorySnapshot = Readonly<{
  status: BuilderProjectHistoryStatus;
  project_id: string | null;
  history: BuilderProjectHistoryResult | null;
  busy: boolean;
  error: 'unavailable' | null;
}>;

export type BuilderProjectHistoryController = Readonly<{
  getSnapshot(): BuilderProjectHistorySnapshot;
  subscribe(listener: () => void): () => void;
  load(projectId?: string | null): Promise<BuilderProjectHistorySnapshot>;
  refresh(): Promise<BuilderProjectHistorySnapshot>;
  reload(): Promise<BuilderProjectHistorySnapshot>;
  dispose(): void;
}>;

const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TRUSTED_SNAPSHOTS = new WeakSet<object>();

function snapshot(
  status: BuilderProjectHistoryStatus,
  projectId: string | null,
  history: BuilderProjectHistoryResult | null,
  error: 'unavailable' | null,
): BuilderProjectHistorySnapshot {
  const result = Object.freeze({
    status,
    project_id: projectId,
    history,
    busy: status === 'loading' || status === 'refreshing',
    error,
  });
  TRUSTED_SNAPSHOTS.add(result);
  return result;
}

export function isTrustedBuilderProjectHistorySnapshot(
  value: unknown,
): value is BuilderProjectHistorySnapshot {
  return value !== null && typeof value === 'object' && TRUSTED_SNAPSHOTS.has(value);
}

export function createBuilderProjectHistoryController(
  port: BuilderProjectHistoryPort,
): BuilderProjectHistoryController {
  let current = snapshot('idle', null, null, null);
  let generation = 0;
  let disposed = false;
  let active: Promise<BuilderProjectHistorySnapshot> | null = null;
  const listeners = new Set<() => void>();

  function publish(next: BuilderProjectHistorySnapshot): BuilderProjectHistorySnapshot {
    if (disposed) return current;
    current = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observers cannot interrupt history state */ }
    }
    return current;
  }

  function run(projectId: string, mode: 'load' | 'refresh'): Promise<BuilderProjectHistorySnapshot> {
    if (disposed) return Promise.resolve(current);
    if (active !== null) return active;
    const operationGeneration = ++generation;
    const retained = current.project_id === projectId ? current.history : null;
    const retainsHistory = mode === 'refresh'
      && retained !== null
      && (current.status === 'ready' || current.status === 'stale');
    publish(snapshot(retainsHistory ? 'refreshing' : 'loading', projectId, retained, null));
    const running = Promise.resolve()
      .then(() => port.listHistory({
        project_id: projectId,
        limit: BUILDER_PROJECT_HISTORY_LIMIT,
      }))
      .then((raw) => (
        disposed || operationGeneration !== generation
          ? null
          : sanitizeBuilderProjectHistoryResult(raw)
      ))
      .then((history) => {
        if (history === null || disposed || operationGeneration !== generation) return current;
        if (history.project_id !== projectId) throw new Error();
        return publish(snapshot('ready', projectId, history, null));
      })
      .catch(() => {
        if (disposed || operationGeneration !== generation) return current;
        return publish(snapshot(
          retainsHistory ? 'stale' : 'unavailable',
          projectId,
          retained,
          'unavailable',
        ));
      });
    active = running;
    void running.finally(() => {
      if (active === running) active = null;
    }).catch(() => undefined);
    return running;
  }

  return Object.freeze({
    getSnapshot: () => current,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load(projectId = null) {
      if (projectId === null || projectId === undefined) {
        generation += 1;
        active = null;
        return Promise.resolve(publish(snapshot('idle', null, null, null)));
      }
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        generation += 1;
        active = null;
        return Promise.resolve(publish(snapshot('unavailable', null, null, 'unavailable')));
      }
      if (current.project_id === projectId && active !== null) return active;
      if (
        current.project_id === projectId
        && current.history !== null
        && (current.status === 'ready' || current.status === 'stale')
      ) return Promise.resolve(current);
      generation += 1;
      active = null;
      return run(projectId, 'load');
    },
    refresh() {
      if (current.project_id === null) return Promise.resolve(current);
      return run(current.project_id, 'refresh');
    },
    reload() {
      if (current.project_id === null || disposed) return Promise.resolve(current);
      generation += 1;
      active = null;
      return run(current.project_id, 'refresh');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      active = null;
      listeners.clear();
    },
  });
}
