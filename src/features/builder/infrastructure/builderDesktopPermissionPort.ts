import type {
  BuilderPermissionAction,
  BuilderPermissionDecision,
  BuilderPermissionPort,
  BuilderPermissionRequest,
  BuilderPermissionResourceKind,
} from '../application/builderPorts';

type BuilderPermissionBridge = Readonly<{
  evaluate(request: unknown): Promise<unknown>;
}>;

const BRIDGE_KEYS = Object.freeze(['evaluate']);
const REQUEST_KEYS = Object.freeze(['project_id', 'action', 'resource_kind', 'resource_id']);
const RESOURCE_KEYS = Object.freeze(['resource_kind', 'project_id', 'resource_id']);
const DECISION_KEYS = Object.freeze([
  'decision_version',
  'policy_version',
  'actor_id',
  'action',
  'resource',
  'evaluated_at_ms',
  'decision',
  'reason',
  'permission_id',
  'permission_authority',
  'ui_selection_authority',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTOR_ID_PATTERN =
  /^(?:builder-user|builder-agent):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PERMISSION_ID_PATTERN = /^builder-permission:[0-9a-f]{64}$/u;
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9._:/@-]{0,127}$/u;

function resourceKinds(
  ...value: BuilderPermissionResourceKind[]
): readonly BuilderPermissionResourceKind[] {
  return Object.freeze(value);
}

const ACTION_RESOURCE_KINDS: Readonly<Record<
  BuilderPermissionAction,
  readonly BuilderPermissionResourceKind[]
>> = Object.freeze({
  'context.read': resourceKinds('project', 'conversation', 'task', 'run', 'revision', 'artifact'),
  'project.read': resourceKinds('project', 'revision'),
  'project.edit': resourceKinds('project'),
  'secret.read': resourceKinds('secret'),
  'filesystem.read': resourceKinds('filesystem'),
  'filesystem.write': resourceKinds('filesystem'),
  'network.request': resourceKinds('network'),
  'process.spawn': resourceKinds('process'),
  'publication.create': resourceKinds('publication'),
  'permission.grant': resourceKinds('permission'),
});

export class BuilderDesktopPermissionPortError extends Error {
  readonly code = 'builder_permission_unavailable';

  constructor() {
    super('Project permissions are unavailable.');
    this.name = 'BuilderDesktopPermissionPortError';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function unavailable(): BuilderDesktopPermissionPortError {
  return new BuilderDesktopPermissionPortError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactDescriptors(
  value: unknown,
  keys: readonly string[],
): Record<string, PropertyDescriptor> {
  if (!isPlainObject(value)) throw unavailable();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
    ) throw unavailable();
  }
  return descriptors;
}

function sanitizeBridge(value: unknown): BuilderPermissionBridge {
  const descriptors = exactDescriptors(value, BRIDGE_KEYS);
  if (typeof descriptors.evaluate.value !== 'function') throw unavailable();
  return Object.freeze({
    evaluate: descriptors.evaluate.value as (request: unknown) => Promise<unknown>,
  });
}

function safeProjectId(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) throw unavailable();
  return value;
}

function safeAction(value: unknown): BuilderPermissionAction {
  if (typeof value !== 'string' || !Object.hasOwn(ACTION_RESOURCE_KINDS, value)) {
    throw unavailable();
  }
  return value as BuilderPermissionAction;
}

function safeResourceKind(value: unknown, action: BuilderPermissionAction): BuilderPermissionResourceKind {
  if (
    typeof value !== 'string'
    || !ACTION_RESOURCE_KINDS[action].includes(value as BuilderPermissionResourceKind)
  ) throw unavailable();
  return value as BuilderPermissionResourceKind;
}

function safeResourceId(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || !RESOURCE_ID_PATTERN.test(value)
  ) throw unavailable();
  return value;
}

function safeTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw unavailable();
  return value;
}

function safePermissionId(value: unknown, decision: 'allowed' | 'denied'): string | null {
  if (decision === 'denied') {
    if (value !== null) throw unavailable();
    return null;
  }
  if (typeof value !== 'string' || !PERMISSION_ID_PATTERN.test(value)) throw unavailable();
  return value;
}

function sanitizeRequest(value: BuilderPermissionRequest): BuilderPermissionRequest {
  const descriptors = exactDescriptors(value, REQUEST_KEYS);
  const action = safeAction(descriptors.action.value);
  return Object.freeze({
    project_id: safeProjectId(descriptors.project_id.value),
    action,
    resource_kind: safeResourceKind(descriptors.resource_kind.value, action),
    resource_id: safeResourceId(descriptors.resource_id.value),
  });
}

function sanitizeResource(
  value: unknown,
  request: BuilderPermissionRequest,
): BuilderPermissionDecision['resource'] {
  const descriptors = exactDescriptors(value, RESOURCE_KEYS);
  const resource = Object.freeze({
    resource_kind: descriptors.resource_kind.value,
    project_id: descriptors.project_id.value,
    resource_id: descriptors.resource_id.value,
  });
  if (
    resource.resource_kind !== request.resource_kind
    || resource.project_id !== request.project_id
    || resource.resource_id !== request.resource_id
  ) throw unavailable();
  return Object.freeze({
    resource_kind: safeResourceKind(resource.resource_kind, request.action),
    project_id: safeProjectId(resource.project_id),
    resource_id: safeResourceId(resource.resource_id),
  });
}

function sanitizeDecision(value: unknown, request: BuilderPermissionRequest): BuilderPermissionDecision {
  const descriptors = exactDescriptors(value, DECISION_KEYS);
  const decision = descriptors.decision.value;
  const reason = descriptors.reason.value;
  if (
    descriptors.decision_version.value !== 'builder-permission-decision.v1'
    || descriptors.policy_version.value !== 'builder-permission-policy.v1'
    || typeof descriptors.actor_id.value !== 'string'
    || !ACTOR_ID_PATTERN.test(descriptors.actor_id.value)
    || descriptors.action.value !== request.action
    || (decision !== 'allowed' && decision !== 'denied')
    || (decision === 'allowed' && reason !== 'matching_active_grant')
    || (decision === 'denied' && reason !== 'no_matching_active_grant')
    || descriptors.permission_authority.value !== 'builder_permission_facts_deny_by_default_v1'
    || descriptors.ui_selection_authority.value !== 'not_permission'
  ) throw unavailable();
  return Object.freeze({
    action: request.action,
    resource: sanitizeResource(descriptors.resource.value, request),
    evaluated_at_ms: safeTimestamp(descriptors.evaluated_at_ms.value),
    decision,
    reason,
    permission_id: safePermissionId(descriptors.permission_id.value, decision),
  });
}

async function evaluate(
  bridge: BuilderPermissionBridge,
  request: BuilderPermissionRequest,
): Promise<BuilderPermissionDecision> {
  try {
    const safeRequest = sanitizeRequest(request);
    return sanitizeDecision(
      await Reflect.apply(bridge.evaluate, bridge, [safeRequest]),
      safeRequest,
    );
  } catch {
    throw unavailable();
  }
}

export function createBuilderDesktopPermissionPort(value: unknown): BuilderPermissionPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    evaluate(request: BuilderPermissionRequest) {
      return evaluate(bridge, request);
    },
  });
}
