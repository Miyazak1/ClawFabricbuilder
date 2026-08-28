import type {
  BuilderAgentWorkbenchPort,
  BuilderWorkbenchTaskProposalDecision,
  BuilderWorkbenchTaskProposalOutcome,
  BuilderWorkbenchMessageStateOperation,
} from './builderPorts';
import {
  sanitizeBuilderAgentWorkbenchProjection,
  type BuilderAgentWorkbenchProjection,
} from '../domain/builderAgentWorkbenchProjection';

export type BuilderAgentWorkbenchSnapshot = Readonly<{
  status: 'loading' | 'ready' | 'refreshing' | 'stale' | 'unavailable';
  projection: BuilderAgentWorkbenchProjection | null;
  busy: boolean;
}>;

export type BuilderAgentWorkbenchController = Readonly<{
  getSnapshot(): BuilderAgentWorkbenchSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<BuilderAgentWorkbenchSnapshot>;
  refresh(): Promise<BuilderAgentWorkbenchSnapshot>;
  updateMessageState(
    messageId: string,
    operation: BuilderWorkbenchMessageStateOperation,
  ): Promise<BuilderAgentWorkbenchSnapshot>;
  createTaskProposal(request: Readonly<{
    request_id: string;
    objective: string;
    requested_outcome: BuilderWorkbenchTaskProposalOutcome;
    execution_mode: 'foreground' | 'parallel';
    reason: string;
  }>): Promise<BuilderAgentWorkbenchSnapshot>;
  decideTaskProposal(request: Readonly<{
    proposal_id: string;
    operation: BuilderWorkbenchTaskProposalDecision;
    project_id: string | null;
  }>): Promise<BuilderAgentWorkbenchSnapshot>;
  controlTask(request: Readonly<{
    project_id: string;
    task_address_id: string;
    operation: 'cancel_task';
  }>): Promise<BuilderAgentWorkbenchSnapshot>;
  dispose(): void;
}>;

function createSnapshot(
  status: BuilderAgentWorkbenchSnapshot['status'],
  projection: BuilderAgentWorkbenchProjection | null,
): BuilderAgentWorkbenchSnapshot {
  return Object.freeze({
    status,
    projection,
    busy: status === 'loading' || status === 'refreshing',
  });
}

export function createBuilderAgentWorkbenchController(
  port: BuilderAgentWorkbenchPort,
  agentId: string,
): BuilderAgentWorkbenchController {
  let current = createSnapshot('loading', null);
  let disposed = false;
  let generation = 0;
  let active: Promise<BuilderAgentWorkbenchSnapshot> | null = null;
  let invalidatedDuringRead = false;
  const listeners = new Set<() => void>();

  function publish(next: BuilderAgentWorkbenchSnapshot) {
    if (disposed) return current;
    current = next;
    for (const listener of listeners) {
      try { listener(); } catch { /* observer isolation */ }
    }
    return current;
  }

  function run(): Promise<BuilderAgentWorkbenchSnapshot> {
    if (disposed) return Promise.resolve(current);
    if (active !== null) return active;
    const token = ++generation;
    const retained = current.projection;
    publish(createSnapshot(retained === null ? 'loading' : 'refreshing', retained));
    const running = Promise.resolve(port.read({
      agent_id: agentId,
      after_cursor: null,
      limit: 200,
    }))
      .then(sanitizeBuilderAgentWorkbenchProjection)
      .then((projection) => (
        token === generation && !disposed
          ? publish(createSnapshot('ready', projection))
          : current
      ))
      .catch(() => (
        token === generation && !disposed
          ? publish(createSnapshot(retained === null ? 'unavailable' : 'stale', retained))
          : current
      ));
    active = running;
    void running.finally(() => {
      if (active !== running) return;
      active = null;
      if (invalidatedDuringRead && !disposed) {
        invalidatedDuringRead = false;
        void run();
      }
    }).catch(() => undefined);
    return running;
  }

  let unsubscribeChanged: () => void = () => undefined;
  try {
    unsubscribeChanged = port.subscribeChanged((event) => {
      if (disposed || event.agent_id !== agentId) return;
      if (active !== null) {
        invalidatedDuringRead = true;
        return;
      }
      void run();
    });
  } catch {
    // The first authoritative read still determines availability.
  }

  return Object.freeze({
    getSnapshot: () => current,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: run,
    refresh: run,
    async updateMessageState(messageId, operation) {
      if (disposed) return current;
      try {
        await port.updateMessageState({
          agent_id: agentId,
          message_id: messageId,
          operation,
        });
      } catch {
        return publish(createSnapshot(
          current.projection === null ? 'unavailable' : 'stale',
          current.projection,
        ));
      }
      return run();
    },
    async createTaskProposal(request) {
      if (disposed) return current;
      try {
        await port.createTaskProposal({ agent_id: agentId, ...request });
      } catch {
        return publish(createSnapshot(
          current.projection === null ? 'unavailable' : 'stale',
          current.projection,
        ));
      }
      return run();
    },
    async decideTaskProposal(request) {
      if (disposed) return current;
      try {
        await port.decideTaskProposal({ agent_id: agentId, ...request });
      } catch {
        return publish(createSnapshot(
          current.projection === null ? 'unavailable' : 'stale',
          current.projection,
        ));
      }
      return run();
    },
    async controlTask(request) {
      if (disposed) return current;
      try {
        await port.controlTask({ agent_id: agentId, ...request });
      } catch {
        return publish(createSnapshot(
          current.projection === null ? 'unavailable' : 'stale',
          current.projection,
        ));
      }
      return run();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      active = null;
      invalidatedDuringRead = false;
      listeners.clear();
      try { unsubscribeChanged(); } catch { /* observer isolation */ }
    },
  });
}
