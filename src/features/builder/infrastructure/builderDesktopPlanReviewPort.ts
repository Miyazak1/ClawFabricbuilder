import type {
  BuilderPlanReviewPort,
  BuilderPlanReviewRequest,
  BuilderPlanReviewResult,
} from '../application/builderPorts';

type BuilderPlanReviewBridge = Readonly<{
  review(request: unknown): Promise<unknown>;
}>;

const BRIDGE_KEYS = Object.freeze(['review']);
const REQUEST_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'run_id',
  'decision',
]);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'project_id',
  'conversation_id',
  'turn_id',
  'run_id',
  'decision',
  'review_admission',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN =
  /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN =
  /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class BuilderDesktopPlanReviewPortError extends Error {
  readonly code = 'builder_plan_review_unavailable';

  constructor() {
    super('Plan review is unavailable.');
    this.name = 'BuilderDesktopPlanReviewPortError';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function unavailable(): BuilderDesktopPlanReviewPortError {
  return new BuilderDesktopPlanReviewPortError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw unavailable();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
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
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, descriptors[key].value])));
}

function sanitizeBridge(value: unknown): BuilderPlanReviewBridge {
  try {
    const source = exactRecord(value, BRIDGE_KEYS);
    if (typeof source.review !== 'function') throw unavailable();
    return Object.freeze({
      review: source.review as (request: unknown) => Promise<unknown>,
    });
  } catch {
    throw unavailable();
  }
}

function projectUuid(projectId: string): string {
  return projectId.slice('builder-project:'.length);
}

function sanitizeRequest(request: BuilderPlanReviewRequest): BuilderPlanReviewRequest {
  const source = exactRecord(request, REQUEST_KEYS);
  if (
    typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || typeof source.conversation_id !== 'string'
    || !CONVERSATION_ID_PATTERN.test(source.conversation_id)
    || source.conversation_id !== `builder-conversation:${projectUuid(source.project_id)}`
    || typeof source.turn_id !== 'string'
    || !TURN_ID_PATTERN.test(source.turn_id)
    || typeof source.run_id !== 'string'
    || !RUN_ID_PATTERN.test(source.run_id)
    || (source.decision !== 'approved' && source.decision !== 'rejected')
  ) throw unavailable();
  return Object.freeze({
    project_id: source.project_id,
    conversation_id: source.conversation_id,
    turn_id: source.turn_id,
    run_id: source.run_id,
    decision: source.decision,
  });
}

function sanitizeResult(value: unknown, request: BuilderPlanReviewRequest): BuilderPlanReviewResult {
  const source = exactRecord(value, RESULT_KEYS);
  if (
    source.result_version !== 'builder-conversation-plan-review-result.v1'
    || source.project_id !== request.project_id
    || source.conversation_id !== request.conversation_id
    || source.turn_id !== request.turn_id
    || source.run_id !== request.run_id
    || source.decision !== request.decision
    || source.review_admission !== 'sqlite_recorded_no_execution'
  ) throw unavailable();
  return Object.freeze({
    result_version: 'builder-conversation-plan-review-result.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    turn_id: request.turn_id,
    run_id: request.run_id,
    decision: request.decision,
    review_admission: 'sqlite_recorded_no_execution',
  });
}

async function callReview(
  bridge: BuilderPlanReviewBridge,
  request: BuilderPlanReviewRequest,
): Promise<BuilderPlanReviewResult> {
  try {
    const safeRequest = sanitizeRequest(request);
    return sanitizeResult(await Reflect.apply(bridge.review, bridge, [safeRequest]), safeRequest);
  } catch {
    throw unavailable();
  }
}

export function createBuilderDesktopPlanReviewPort(value: unknown): BuilderPlanReviewPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    review(request: BuilderPlanReviewRequest) {
      return callReview(bridge, request);
    },
  });
}
