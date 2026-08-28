import type { BuilderAgentProjectTreePort } from './builderPorts';
import { sanitizeBuilderAgentProjectTreeProjection, type BuilderAgentProjectTreeProjection } from '../domain/builderAgentProjectTreeProjection';

export type BuilderAgentProjectTreeSnapshot = Readonly<{
  status: 'loading' | 'ready' | 'refreshing' | 'stale' | 'unavailable';
  tree: BuilderAgentProjectTreeProjection | null;
  busy: boolean;
}>;
export type BuilderAgentProjectTreeController = Readonly<{
  getSnapshot(): BuilderAgentProjectTreeSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<BuilderAgentProjectTreeSnapshot>;
  refresh(): Promise<BuilderAgentProjectTreeSnapshot>;
  dispose(): void;
}>;

function snapshot(status: BuilderAgentProjectTreeSnapshot['status'], tree: BuilderAgentProjectTreeProjection | null): BuilderAgentProjectTreeSnapshot {
  return Object.freeze({ status, tree, busy: status === 'loading' || status === 'refreshing' });
}
export function createBuilderAgentProjectTreeController(port: BuilderAgentProjectTreePort, agentId: string): BuilderAgentProjectTreeController {
  let current = snapshot('loading', null);
  let disposed = false;
  let generation = 0;
  let active: Promise<BuilderAgentProjectTreeSnapshot> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: BuilderAgentProjectTreeSnapshot) => {
    if (!disposed) { current = next; for (const listener of listeners) { try { listener(); } catch { /* observer isolation */ } } }
    return current;
  };
  const run = () => {
    if (disposed) return Promise.resolve(current);
    if (active !== null) return active;
    const token = ++generation;
    const retained = current.tree;
    publish(snapshot(retained === null ? 'loading' : 'refreshing', retained));
    const running = Promise.resolve(port.read({ agent_id: agentId }))
      .then(sanitizeBuilderAgentProjectTreeProjection)
      .then((tree) => token === generation && !disposed ? publish(snapshot('ready', tree)) : current)
      .catch(() => token === generation && !disposed ? publish(snapshot(retained === null ? 'unavailable' : 'stale', retained)) : current);
    active = running;
    void running.finally(() => { if (active === running) active = null; }).catch(() => undefined);
    return running;
  };
  return Object.freeze({
    getSnapshot: () => current,
    subscribe(listener) { if (disposed) return () => undefined; listeners.add(listener); return () => listeners.delete(listener); },
    load: run, refresh: run,
    dispose() { disposed = true; generation += 1; active = null; listeners.clear(); },
  });
}
