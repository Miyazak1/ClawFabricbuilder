import type { BuilderTaskStreamChangedEvent, BuilderTaskStreamPort } from './builderPorts';
import {
  sanitizeBuilderConversationSnapshot,
  type BuilderConversationSnapshot,
} from '../domain/builderConversationSnapshot';
import { incrementBuilderPerformance } from './builderPerformanceTrace';

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
  agent_id: string | null;
  project_id: string | null;
  task_address_id: string | null;
  conversation: BuilderConversationSnapshot | null;
  busy: boolean;
  error: 'unavailable' | null;
}>;

export type BuilderConversationController = Readonly<{
  getSnapshot(): BuilderConversationControllerSnapshot;
  subscribe(listener: () => void): () => void;
  load(
    projectId?: string | null,
    taskAddressId?: string | null,
    agentId?: string | null,
  ): Promise<BuilderConversationControllerSnapshot>;
  refresh(): Promise<BuilderConversationControllerSnapshot>;
  probe(projectId: string, taskAddressId: string): Promise<BuilderConversationControllerSnapshot>;
  dispose(): void;
}>;

const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ADDRESS_ID_PATTERN =
  /^builder-task-address:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AGENT_ID_PATTERN =
  /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DURABLE_CHANGED_COALESCE_MS = 160;
const TRUSTED_SNAPSHOTS = new WeakSet<object>();

function snapshot(
  status: BuilderConversationControllerStatus,
  agentId: string | null,
  projectId: string | null,
  taskAddressId: string | null,
  conversation: BuilderConversationSnapshot | null,
  error: 'unavailable' | null,
): BuilderConversationControllerSnapshot {
  const result = Object.freeze({
    status,
    agent_id: agentId,
    project_id: projectId,
    task_address_id: taskAddressId,
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
  let current = snapshot('idle', null, null, null, null, null);
  let generation = 0;
  let disposed = false;
  let active: Promise<BuilderConversationControllerSnapshot> | null = null;
  let pendingChanged = false;
  let latestDurableCursor = 0;
  let changedRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeChanged: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function publish(next: BuilderConversationControllerSnapshot): BuilderConversationControllerSnapshot {
    if (disposed) return current;
    incrementBuilderPerformance('renderer.task_stream.controller_publish_count');
    current = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observers cannot interrupt conversation state */ }
    }
    return current;
  }

  function clearChangedRefreshTimer(): void {
    if (changedRefreshTimer !== null) clearTimeout(changedRefreshTimer);
    changedRefreshTimer = null;
  }

  function run(
    agentId: string | null,
    projectId: string | null,
    taskAddressId: string | null,
    background = false,
  ): Promise<BuilderConversationControllerSnapshot> {
    if (disposed) return Promise.resolve(current);
    if (active !== null) return active;
    if (!background) {
      clearChangedRefreshTimer();
      pendingChanged = false;
    }
    const operationGeneration = ++generation;
    const retained = current.agent_id === agentId
      && current.project_id === projectId
      && current.task_address_id === taskAddressId
      ? current.conversation
      : null;
    const retainsConversation = retained !== null
      && ['absent', 'ready', 'stale'].includes(current.status);
    if (!background) {
      publish(snapshot(
        retainsConversation ? 'refreshing' : 'loading',
        agentId,
        projectId,
        taskAddressId,
        retained,
        null,
      ));
    }
    const running = Promise.resolve()
      .then(() => port.read(agentId === null
        ? { project_id: projectId as string, task_address_id: taskAddressId as string }
        : { agent_id: agentId }))
      .then((raw) => (
        disposed || operationGeneration !== generation
          ? null
          : sanitizeBuilderConversationSnapshot(raw)
      ))
      .then((conversation) => {
        if (conversation === null || disposed || operationGeneration !== generation) return current;
        if (
          conversation.project_id !== projectId
          || (agentId !== null && conversation.agent_id !== agentId)
        ) throw new Error();
        if (
          background
          && current.agent_id === agentId
          && current.project_id === projectId
          && current.task_address_id === taskAddressId
          && current.conversation === conversation
          && current.error === null
          && current.status === statusFor(conversation)
        ) return current;
        return publish(snapshot(
          statusFor(conversation),
          agentId,
          projectId,
          taskAddressId,
          conversation,
          null,
        ));
      })
      .catch(() => {
        if (disposed || operationGeneration !== generation) return current;
        return publish(snapshot(
          retainsConversation ? 'stale' : 'unavailable',
          agentId,
          projectId,
          taskAddressId,
          retained,
          'unavailable',
        ));
      });
    active = running;
    void running.finally(() => {
      if (active === running) active = null;
      if (
        disposed
        || !pendingChanged
        || active !== null
      ) return;
      pendingChanged = false;
      void run(current.agent_id, current.project_id, current.task_address_id, true)
        .catch(() => undefined);
    }).catch(() => undefined);
    return running;
  }

  function handleChangedEvent(event: BuilderTaskStreamChangedEvent): void {
    if (event.event_version === 'builder-task-stream-changed.v2' && event.change_kind === 'live_only') {
      incrementBuilderPerformance('renderer.task_stream.ignored_live_only_count');
      return;
    }
    const matches = 'agent_id' in event
      ? current.agent_id === event.agent_id
      : current.project_id === event.project_id;
    if (disposed || !matches) return;
    if (event.event_version === 'builder-task-stream-changed.v2') {
      if (event.cursor <= latestDurableCursor) {
        incrementBuilderPerformance('renderer.task_stream.changed.coalesced_count');
        return;
      }
      latestDurableCursor = event.cursor;
    }
    if (active !== null) {
      pendingChanged = true;
      return;
    }
    if (changedRefreshTimer !== null) {
      incrementBuilderPerformance('renderer.task_stream.changed.coalesced_count');
      return;
    }
    const scheduledAgentId = current.agent_id;
    const scheduledProjectId = current.project_id;
    const scheduledTaskAddressId = current.task_address_id;
    changedRefreshTimer = setTimeout(() => {
      changedRefreshTimer = null;
      if (
        disposed
        || current.agent_id !== scheduledAgentId
        || current.project_id !== scheduledProjectId
        || current.task_address_id !== scheduledTaskAddressId
      ) return;
      if (active !== null) {
        pendingChanged = true;
        return;
      }
      void run(current.agent_id, current.project_id, current.task_address_id, true)
        .catch(() => undefined);
    }, DURABLE_CHANGED_COALESCE_MS);
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
    load(projectId = null, taskAddressId = null, agentId = null) {
      if (projectId === null || projectId === undefined) {
        if (typeof agentId === 'string' && AGENT_ID_PATTERN.test(agentId)) {
          if (current.agent_id === agentId && active !== null) return active;
          generation += 1;
          active = null;
          pendingChanged = false;
          latestDurableCursor = 0;
          return run(agentId, null, null);
        }
        generation += 1;
        active = null;
        pendingChanged = false;
        latestDurableCursor = 0;
        return Promise.resolve(publish(snapshot('idle', null, null, null, null, null)));
      }
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        generation += 1;
        active = null;
        pendingChanged = false;
        latestDurableCursor = 0;
        return Promise.resolve(publish(snapshot('unavailable', null, null, null, null, 'unavailable')));
      }
      if (taskAddressId === null || taskAddressId === undefined) {
        generation += 1;
        active = null;
        pendingChanged = false;
        latestDurableCursor = 0;
        return Promise.resolve(publish(snapshot('absent', null, projectId, null, null, null)));
      }
      if (!TASK_ADDRESS_ID_PATTERN.test(taskAddressId)) {
        generation += 1;
        active = null;
        pendingChanged = false;
        latestDurableCursor = 0;
        return Promise.resolve(publish(snapshot('unavailable', null, projectId, null, null, 'unavailable')));
      }
      if (
        current.project_id === projectId
        && current.task_address_id === taskAddressId
        && active !== null
      ) return active;
      generation += 1;
      active = null;
      pendingChanged = false;
      latestDurableCursor = 0;
      return run(null, projectId, taskAddressId);
    },
    refresh() {
      if (current.agent_id === null && (current.project_id === null || current.task_address_id === null)) {
        return Promise.resolve(current);
      }
      return run(current.agent_id, current.project_id, current.task_address_id);
    },
    async probe(projectId, taskAddressId) {
      if (
        disposed
        || !PROJECT_ID_PATTERN.test(projectId)
        || !TASK_ADDRESS_ID_PATTERN.test(taskAddressId)
      ) {
        return snapshot('unavailable', null, projectId, taskAddressId, null, 'unavailable');
      }
      try {
        const conversation = sanitizeBuilderConversationSnapshot(await port.read({
          project_id: projectId,
          task_address_id: taskAddressId,
        }));
        if (conversation === null || conversation.project_id !== projectId) throw new Error();
        return snapshot(statusFor(conversation), null, projectId, taskAddressId, conversation, null);
      } catch {
        return snapshot('unavailable', null, projectId, taskAddressId, null, 'unavailable');
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      active = null;
      pendingChanged = false;
      clearChangedRefreshTimer();
      listeners.clear();
      try { unsubscribeChanged?.(); } catch { /* unsubscribe is best-effort */ }
      unsubscribeChanged = null;
    },
  });
}
