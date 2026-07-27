import type { BuilderTaskStreamChangedEvent, BuilderTaskStreamPort } from './builderPorts';
import {
  sanitizeBuilderConversationSnapshot,
  type BuilderConversationSnapshot,
} from '../domain/builderConversationSnapshot';

export type BuilderConversationControllerStatus =
  | 'idle'
  | 'loading'
  | 'absent'
  | 'ready'
  | 'refreshing'
  | 'stale'
  | 'unavailable';

export type BuilderConversationControllerSnapshot = Readonly<{
  status: BuilderConversationControllerStatus;
  project_id: string | null;
  conversation: BuilderConversationSnapshot | null;
  busy: boolean;
  error: 'unavailable' | null;
}>;

export type BuilderConversationController = Readonly<{
  getSnapshot(): BuilderConversationControllerSnapshot;
  subscribe(listener: () => void): () => void;
  load(projectId?: string | null): Promise<BuilderConversationControllerSnapshot>;
  refresh(): Promise<BuilderConversationControllerSnapshot>;
  dispose(): void;
}>;

const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TRUSTED_SNAPSHOTS = new WeakSet<object>();

function snapshot(
  status: BuilderConversationControllerStatus,
  projectId: string | null,
  conversation: BuilderConversationSnapshot | null,
  error: 'unavailable' | null,
): BuilderConversationControllerSnapshot {
  const result = Object.freeze({
    status,
    project_id: projectId,
    conversation,
    busy: status === 'loading' || status === 'refreshing',
    error,
  });
  TRUSTED_SNAPSHOTS.add(result);
  return result;
}

function statusFor(conversation: BuilderConversationSnapshot): 'absent' | 'ready' {
  return conversation.state;
}

export function isTrustedBuilderConversationControllerSnapshot(
  value: unknown,
): value is BuilderConversationControllerSnapshot {
  return value !== null && typeof value === 'object' && TRUSTED_SNAPSHOTS.has(value);
}

export function createBuilderConversationController(
  port: BuilderTaskStreamPort,
): BuilderConversationController {
  let current = snapshot('idle', null, null, null);
  let generation = 0;
  let disposed = false;
  let active: Promise<BuilderConversationControllerSnapshot> | null = null;
  let pendingChangedProjectId: string | null = null;
  let unsubscribeChanged: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function publish(next: BuilderConversationControllerSnapshot): BuilderConversationControllerSnapshot {
    if (disposed) return current;
    current = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observers cannot interrupt conversation state */ }
    }
    return current;
  }

  function run(projectId: string, mode: 'load' | 'refresh'): Promise<BuilderConversationControllerSnapshot> {
    if (disposed) return Promise.resolve(current);
    if (active !== null) return active;
    const operationGeneration = ++generation;
    const retained = current.project_id === projectId ? current.conversation : null;
    const retainsConversation = mode === 'refresh' && retained !== null
      && ['absent', 'ready', 'stale'].includes(current.status);
    publish(snapshot(retainsConversation ? 'refreshing' : 'loading', projectId, retained, null));
    const running = Promise.resolve()
      .then(() => port.read({ project_id: projectId }))
      .then((raw) => (
        disposed || operationGeneration !== generation
          ? null
          : sanitizeBuilderConversationSnapshot(raw)
      ))
      .then((conversation) => {
        if (conversation === null || disposed || operationGeneration !== generation) return current;
        if (conversation.project_id !== projectId) throw new Error();
        return publish(snapshot(statusFor(conversation), projectId, conversation, null));
      })
      .catch(() => {
        if (disposed || operationGeneration !== generation) return current;
        return publish(snapshot(
          retainsConversation ? 'stale' : 'unavailable',
          projectId,
          retained,
          'unavailable',
        ));
      });
    active = running;
    void running.finally(() => {
      if (active === running) active = null;
      const pendingProjectId = pendingChangedProjectId;
      if (
        disposed
        || pendingProjectId === null
        || pendingProjectId !== current.project_id
        || active !== null
      ) return;
      pendingChangedProjectId = null;
      void run(pendingProjectId, 'refresh').catch(() => undefined);
    }).catch(() => undefined);
    return running;
  }

  function handleChangedEvent(event: BuilderTaskStreamChangedEvent): void {
    if (disposed || current.project_id !== event.project_id) return;
    if (active !== null) {
      pendingChangedProjectId = event.project_id;
      return;
    }
    void run(event.project_id, 'refresh').catch(() => undefined);
  }

  try {
    unsubscribeChanged = port.subscribeChanged(handleChangedEvent);
  } catch {
    unsubscribeChanged = null;
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
        pendingChangedProjectId = null;
        return Promise.resolve(publish(snapshot('idle', null, null, null)));
      }
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        generation += 1;
        active = null;
        pendingChangedProjectId = null;
        return Promise.resolve(publish(snapshot('unavailable', null, null, 'unavailable')));
      }
      if (current.project_id === projectId && active !== null) return active;
      generation += 1;
      active = null;
      pendingChangedProjectId = null;
      return run(projectId, 'load');
    },
    refresh() {
      if (current.project_id === null) return Promise.resolve(current);
      return run(current.project_id, 'refresh');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      active = null;
      pendingChangedProjectId = null;
      listeners.clear();
      try { unsubscribeChanged?.(); } catch { /* unsubscribe is best-effort */ }
      unsubscribeChanged = null;
    },
  });
}
