import type {
  BuilderAgentWorkbenchPort,
  BuilderWorkbenchChangedEvent,
} from '../application/builderPorts';

const BRIDGE_KEYS = Object.freeze([
  'read', 'updateMessageState', 'createTaskProposal', 'decideTaskProposal', 'decideAgentPlan', 'controlTask',
  'subscribeChanged',
]);
const AGENT_ID =
  /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MESSAGE_ID =
  /^builder-message:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_ID =
  /^builder-workbench-request:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROPOSAL_ID =
  /^builder-task-proposal:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ID =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ADDRESS_ID =
  /^builder-task-address:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AGENT_PLAN_ID =
  /^builder-agent-plan:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

type Bridge = Readonly<{
  read(request: unknown): Promise<unknown>;
  updateMessageState(request: unknown): Promise<unknown>;
  createTaskProposal(request: unknown): Promise<unknown>;
  decideTaskProposal(request: unknown): Promise<unknown>;
  decideAgentPlan(request: unknown): Promise<unknown>;
  controlTask(request: unknown): Promise<unknown>;
  subscribeChanged(listener: (event: unknown) => void): () => void;
}>;

export class BuilderDesktopAgentWorkbenchPortError extends Error {
  readonly code = 'builder_agent_workbench_unavailable';
  constructor() {
    super('Agent Workbench is unavailable.');
    this.name = 'BuilderDesktopAgentWorkbenchPortError';
  }
}

function unavailable(): never { throw new BuilderDesktopAgentWorkbenchPortError(); }
function method(value: object, key: string): (...args: never[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') unavailable();
  return descriptor.value;
}
function bridge(value: unknown): Bridge {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) unavailable();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== BRIDGE_KEYS.length || keys.some((key) => typeof key !== 'string' || !BRIDGE_KEYS.includes(key))) unavailable();
  return Object.freeze({
    read: method(value, 'read') as Bridge['read'],
    updateMessageState: method(value, 'updateMessageState') as Bridge['updateMessageState'],
    createTaskProposal: method(value, 'createTaskProposal') as Bridge['createTaskProposal'],
    decideTaskProposal: method(value, 'decideTaskProposal') as Bridge['decideTaskProposal'],
    decideAgentPlan: method(value, 'decideAgentPlan') as Bridge['decideAgentPlan'],
    controlTask: method(value, 'controlTask') as Bridge['controlTask'],
    subscribeChanged: method(value, 'subscribeChanged') as Bridge['subscribeChanged'],
  });
}
function changedEvent(value: unknown): BuilderWorkbenchChangedEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) unavailable();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('event_version') || !keys.includes('agent_id')) unavailable();
  const version = Object.getOwnPropertyDescriptor(value, 'event_version');
  const agent = Object.getOwnPropertyDescriptor(value, 'agent_id');
  if (
    !version || !agent || !Object.hasOwn(version, 'value') || !Object.hasOwn(agent, 'value')
    || version.value !== 'builder-agent-workbench-changed.v1'
    || typeof agent.value !== 'string' || !AGENT_ID.test(agent.value)
  ) unavailable();
  return Object.freeze({ event_version: version.value, agent_id: agent.value });
}

export function createBuilderDesktopAgentWorkbenchPort(value: unknown): BuilderAgentWorkbenchPort {
  const target = bridge(value);
  return Object.freeze({
    async read(request: Parameters<BuilderAgentWorkbenchPort['read']>[0]) {
      if (!AGENT_ID.test(request.agent_id)) unavailable();
      try { return structuredClone(await Reflect.apply(target.read, target, [request])); }
      catch { throw new BuilderDesktopAgentWorkbenchPortError(); }
    },
    async updateMessageState(
      request: Parameters<BuilderAgentWorkbenchPort['updateMessageState']>[0],
    ) {
      if (!AGENT_ID.test(request.agent_id) || !MESSAGE_ID.test(request.message_id)) unavailable();
      try { return structuredClone(await Reflect.apply(target.updateMessageState, target, [request])); }
      catch { throw new BuilderDesktopAgentWorkbenchPortError(); }
    },
    async createTaskProposal(request: Parameters<BuilderAgentWorkbenchPort['createTaskProposal']>[0]) {
      if (!AGENT_ID.test(request.agent_id) || !REQUEST_ID.test(request.request_id)) unavailable();
      try { return structuredClone(await Reflect.apply(target.createTaskProposal, target, [request])); }
      catch { throw new BuilderDesktopAgentWorkbenchPortError(); }
    },
    async decideTaskProposal(request: Parameters<BuilderAgentWorkbenchPort['decideTaskProposal']>[0]) {
      if (!AGENT_ID.test(request.agent_id) || !PROPOSAL_ID.test(request.proposal_id)) unavailable();
      try { return structuredClone(await Reflect.apply(target.decideTaskProposal, target, [request])); }
      catch { throw new BuilderDesktopAgentWorkbenchPortError(); }
    },
    async decideAgentPlan(request: Parameters<BuilderAgentWorkbenchPort['decideAgentPlan']>[0]) {
      if (
        !AGENT_ID.test(request.agent_id)
        || !AGENT_PLAN_ID.test(request.agent_plan_id)
        || !DIGEST.test(request.content_digest)
        || (request.decision !== 'approved' && request.decision !== 'rejected')
      ) unavailable();
      try { return structuredClone(await Reflect.apply(target.decideAgentPlan, target, [request])); }
      catch { throw new BuilderDesktopAgentWorkbenchPortError(); }
    },
    async controlTask(request: Parameters<BuilderAgentWorkbenchPort['controlTask']>[0]) {
      if (
        !AGENT_ID.test(request.agent_id)
        || !PROJECT_ID.test(request.project_id)
        || !TASK_ADDRESS_ID.test(request.task_address_id)
        || request.operation !== 'cancel_task'
      ) unavailable();
      try { return structuredClone(await Reflect.apply(target.controlTask, target, [request])); }
      catch { throw new BuilderDesktopAgentWorkbenchPortError(); }
    },
    subscribeChanged(listener: Parameters<BuilderAgentWorkbenchPort['subscribeChanged']>[0]) {
      try {
        return Reflect.apply(target.subscribeChanged, target, [(event: unknown) => {
          try { listener(changedEvent(event)); } catch { /* malformed notifications are ignored */ }
        }]);
      } catch {
        throw new BuilderDesktopAgentWorkbenchPortError();
      }
    },
  });
}
