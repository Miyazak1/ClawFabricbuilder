import type { BuilderAgentProjectTreePort } from '../application/builderPorts';

const BRIDGE_KEYS = Object.freeze([
  'read',
  'renameProject',
  'archiveProject',
  'renameTask',
  'archiveTask',
]);
const AGENT_ID_PATTERN =
  /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ADDRESS_ID_PATTERN =
  /^builder-task-address:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type Bridge = Readonly<{
  read(request: unknown): Promise<unknown>;
  renameProject(request: unknown): Promise<unknown>;
  archiveProject(request: unknown): Promise<unknown>;
  renameTask(request: unknown): Promise<unknown>;
  archiveTask(request: unknown): Promise<unknown>;
}>;

export class BuilderDesktopAgentProjectTreePortError extends Error {
  readonly code = 'builder_agent_project_tree_unavailable';

  constructor() {
    super('Builder agent navigation is unavailable.');
    this.name = 'BuilderDesktopAgentProjectTreePortError';
  }
}

function unavailable(): never {
  throw new BuilderDesktopAgentProjectTreePortError();
}

function bridge(value: unknown): Bridge {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) unavailable();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== BRIDGE_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !BRIDGE_KEYS.includes(key))
  ) unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const methods: Partial<Record<keyof Bridge, Bridge[keyof Bridge]>> = {};
  for (const key of BRIDGE_KEYS) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function'
    ) unavailable();
    methods[key as keyof Bridge] = descriptor.value as Bridge[keyof Bridge];
  }
  return Object.freeze(methods as Bridge);
}

function validTitle(value: string): boolean {
  if (value.length < 1 || value.length > 160 || value.trim() !== value) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

export function createBuilderDesktopAgentProjectTreePort(
  value: unknown,
): BuilderAgentProjectTreePort {
  const target = bridge(value);
  async function call(method: Bridge[keyof Bridge], request: Readonly<Record<string, string>>) {
    try {
      return structuredClone(await Reflect.apply(method, target, [request]));
    } catch {
      throw new BuilderDesktopAgentProjectTreePortError();
    }
  }
  return Object.freeze({
    async read(request: Parameters<BuilderAgentProjectTreePort['read']>[0]) {
      if (!AGENT_ID_PATTERN.test(request.agent_id)) unavailable();
      return call(target.read, { agent_id: request.agent_id });
    },
    async renameProject(request: Parameters<BuilderAgentProjectTreePort['renameProject']>[0]) {
      if (
        !AGENT_ID_PATTERN.test(request.agent_id)
        || !PROJECT_ID_PATTERN.test(request.project_id)
        || !validTitle(request.title)
      ) unavailable();
      return call(target.renameProject, {
        agent_id: request.agent_id,
        project_id: request.project_id,
        title: request.title,
      });
    },
    async archiveProject(request: Parameters<BuilderAgentProjectTreePort['archiveProject']>[0]) {
      if (!AGENT_ID_PATTERN.test(request.agent_id) || !PROJECT_ID_PATTERN.test(request.project_id)) unavailable();
      return call(target.archiveProject, {
        agent_id: request.agent_id,
        project_id: request.project_id,
      });
    },
    async renameTask(request: Parameters<BuilderAgentProjectTreePort['renameTask']>[0]) {
      if (
        !AGENT_ID_PATTERN.test(request.agent_id)
        || !PROJECT_ID_PATTERN.test(request.project_id)
        || !TASK_ADDRESS_ID_PATTERN.test(request.task_address_id)
        || !validTitle(request.title)
      ) unavailable();
      return call(target.renameTask, {
        agent_id: request.agent_id,
        project_id: request.project_id,
        task_address_id: request.task_address_id,
        title: request.title,
      });
    },
    async archiveTask(request: Parameters<BuilderAgentProjectTreePort['archiveTask']>[0]) {
      if (
        !AGENT_ID_PATTERN.test(request.agent_id)
        || !PROJECT_ID_PATTERN.test(request.project_id)
        || !TASK_ADDRESS_ID_PATTERN.test(request.task_address_id)
      ) unavailable();
      return call(target.archiveTask, {
        agent_id: request.agent_id,
        project_id: request.project_id,
        task_address_id: request.task_address_id,
      });
    },
  });
}
