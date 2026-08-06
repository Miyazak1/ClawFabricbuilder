'use strict';

const { types: utilTypes } = require('node:util');

const {
  isPublicBuilderRouteDecisionSignal,
} = require('./builder-route-decision-signals.cjs');

const BUILDER_BUILD_CONTEXT_SNAPSHOT_VERSION = 'builder-build-context-snapshot.v1';
const CONVERSATION_BRIEF_CONTEXT_VERSION = 'builder-conversation-brief.v3';
const CONVERSATION_BRIEF_SELECTION = 'recent_prior_messages_latest_plan_and_working_brief';
const WORKING_BRIEF_VERSION = 'builder-working-brief.v1';

const INPUT_KEYS = Object.freeze(['route_context', 'conversation_brief', 'workspace_basis']);
const ROUTE_CONTEXT_KEYS = Object.freeze(['route', 'dispatch', 'confidence', 'matched_signals']);
const CONVERSATION_BRIEF_KEYS = Object.freeze(['context_version', 'selection', 'entries', 'latest_plan', 'working_brief']);
const LATEST_PLAN_KEYS = Object.freeze(['state', 'text']);
const WORKING_BRIEF_KEYS = Object.freeze([
  'brief_version',
  'source',
  'latest_user_goal',
  'assistant_proposal',
  'approved_plan',
  'use_when_instruction_is_contextual',
]);
const APPROVED_PLAN_KEYS = Object.freeze(['state', 'text']);

const SNAPSHOT_KEYS = Object.freeze([
  'snapshot_version',
  'route',
  'dispatch',
  'confidence',
  'matched_signals',
  'execution_basis',
  'workspace_basis',
  'working_brief',
  'latest_plan',
  'permissions',
]);
const SNAPSHOT_WORKING_BRIEF_KEYS = Object.freeze(['available', 'source', 'contextual_build_ready']);
const SNAPSHOT_LATEST_PLAN_KEYS = Object.freeze(['available', 'state']);
const SNAPSHOT_PERMISSIONS_KEYS = Object.freeze(['write_project', 'command_execution', 'external_network']);

const ROUTES = Object.freeze(['answer', 'clarify', 'update_brief', 'plan', 'build', 'unknown']);
const DISPATCHES = Object.freeze(['reply', 'brief_update', 'plan', 'build', 'ask_workspace', 'ask_permission', 'blocked', 'unknown']);
const CONFIDENCES = Object.freeze(['low', 'medium', 'high', 'unknown']);
const WORKSPACE_BASES = Object.freeze(['new_project_request', 'selected_project_workspace']);
const WORKING_BRIEF_SOURCES = Object.freeze(['task_capsule_update', 'approved_plan']);
const PLAN_STATES = Object.freeze(['none', 'proposed', 'approved', 'rejected']);
const ACTIVE_PLAN_STATES = Object.freeze(['proposed', 'approved', 'rejected']);
const EXECUTION_BASES = Object.freeze([
  'not_admitted',
  'approved_plan',
  'task_brief',
  'working_brief',
  'current_artifact_defect',
  'missing_context_not_admitted',
  'explicit_instruction',
]);
const WRITE_PROJECT_PERMISSIONS = Object.freeze(['route_required', 'not_required_by_route']);

const ERROR_MESSAGES = Object.freeze({
  builder_build_context_snapshot_invalid: 'The build context snapshot could not be verified.',
});

class BuilderBuildContextSnapshotError extends Error {
  constructor(code = 'builder_build_context_snapshot_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_build_context_snapshot_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderBuildContextSnapshotError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderBuildContextSnapshotError();
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, expectedKeys) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}

function sanitizeRouteSignals(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 8) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const signals = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const signal = descriptor.value;
    if (!isPublicBuilderRouteDecisionSignal(signal) || seen.has(signal)) fail();
    seen.add(signal);
    signals.push(signal);
  }
  return Object.freeze(signals);
}

function sanitizeRouteContext(value) {
  if (value === null) {
    return freezeDeep({
      route: 'unknown',
      dispatch: 'unknown',
      confidence: 'unknown',
      matched_signals: [],
    });
  }
  assertExactObject(value, ROUTE_CONTEXT_KEYS);
  return freezeDeep({
    route: safeEnum(valueAt(value, 'route'), ROUTES),
    dispatch: safeEnum(valueAt(value, 'dispatch'), DISPATCHES),
    confidence: safeEnum(valueAt(value, 'confidence'), CONFIDENCES),
    matched_signals: sanitizeRouteSignals(valueAt(value, 'matched_signals')),
  });
}

function sanitizeLatestPlan(value) {
  if (value === null) return null;
  assertExactObject(value, LATEST_PLAN_KEYS);
  return freezeDeep({
    state: safeEnum(valueAt(value, 'state'), ACTIVE_PLAN_STATES),
  });
}

function sanitizeApprovedPlan(value) {
  if (value === null) return null;
  assertExactObject(value, APPROVED_PLAN_KEYS);
  return freezeDeep({
    state: safeEnum(valueAt(value, 'state'), ACTIVE_PLAN_STATES),
  });
}

function sanitizeWorkingBrief(value) {
  if (value === null) return null;
  assertExactObject(value, WORKING_BRIEF_KEYS);
  if (valueAt(value, 'brief_version') !== WORKING_BRIEF_VERSION) fail();
  sanitizeApprovedPlan(valueAt(value, 'approved_plan'));
  const contextual = valueAt(value, 'use_when_instruction_is_contextual');
  if (typeof contextual !== 'boolean') fail();
  return freezeDeep({
    source: safeEnum(valueAt(value, 'source'), WORKING_BRIEF_SOURCES),
    contextual_build_ready: contextual,
  });
}

function sanitizeConversationBrief(value) {
  assertExactObject(value, CONVERSATION_BRIEF_KEYS);
  if (
    valueAt(value, 'context_version') !== CONVERSATION_BRIEF_CONTEXT_VERSION
    || valueAt(value, 'selection') !== CONVERSATION_BRIEF_SELECTION
  ) fail();
  const entries = valueAt(value, 'entries');
  if (!Array.isArray(entries) || utilTypes.isProxy(entries)) fail();
  return freezeDeep({
    latest_plan: sanitizeLatestPlan(valueAt(value, 'latest_plan')),
    working_brief: sanitizeWorkingBrief(valueAt(value, 'working_brief')),
  });
}

function buildExecutionBasis(routeContext, conversationBrief) {
  if (routeContext.route !== 'build' || routeContext.dispatch !== 'build') {
    return 'not_admitted';
  }
  if (
    conversationBrief.latest_plan !== null
    && conversationBrief.latest_plan.state === 'approved'
    && conversationBrief.working_brief !== null
    && conversationBrief.working_brief.source === 'approved_plan'
    && conversationBrief.working_brief.contextual_build_ready === true
  ) {
    return 'approved_plan';
  }
  if (
    conversationBrief.working_brief !== null
    && conversationBrief.working_brief.contextual_build_ready === true
  ) {
    return conversationBrief.working_brief.source === 'task_capsule_update'
      ? 'task_brief'
      : 'working_brief';
  }
  if (routeContext.matched_signals.includes('current_artifact_defect')) {
    return 'current_artifact_defect';
  }
  if (
    routeContext.matched_signals.includes('contextual_build')
    || routeContext.matched_signals.includes('contextual_build_phrase')
  ) {
    return 'missing_context_not_admitted';
  }
  return 'explicit_instruction';
}

function createBuilderBuildContextSnapshot(value) {
  assertExactObject(value, INPUT_KEYS);
  const routeContext = sanitizeRouteContext(valueAt(value, 'route_context'));
  const conversationBrief = sanitizeConversationBrief(valueAt(value, 'conversation_brief'));
  const workspaceBasis = safeEnum(valueAt(value, 'workspace_basis'), WORKSPACE_BASES);
  return freezeDeep({
    snapshot_version: BUILDER_BUILD_CONTEXT_SNAPSHOT_VERSION,
    route: routeContext.route,
    dispatch: routeContext.dispatch,
    confidence: routeContext.confidence,
    matched_signals: [...routeContext.matched_signals],
    execution_basis: buildExecutionBasis(routeContext, conversationBrief),
    workspace_basis: workspaceBasis,
    working_brief: conversationBrief.working_brief === null
      ? {
        available: false,
        source: null,
        contextual_build_ready: false,
      }
      : {
        available: true,
        source: conversationBrief.working_brief.source,
        contextual_build_ready: conversationBrief.working_brief.contextual_build_ready,
      },
    latest_plan: conversationBrief.latest_plan === null
      ? {
        available: false,
        state: 'none',
      }
      : {
        available: true,
        state: conversationBrief.latest_plan.state,
      },
    permissions: {
      write_project: routeContext.route === 'build' ? 'route_required' : 'not_required_by_route',
      command_execution: 'not_available',
      external_network: 'not_available',
    },
  });
}

function sanitizeBuilderBuildContextSnapshot(value) {
  assertExactObject(value, SNAPSHOT_KEYS);
  const route = safeEnum(valueAt(value, 'route'), ROUTES);
  const dispatch = safeEnum(valueAt(value, 'dispatch'), DISPATCHES);
  const executionBasis = safeEnum(valueAt(value, 'execution_basis'), EXECUTION_BASES);
  const permissions = valueAt(value, 'permissions');
  assertExactObject(permissions, SNAPSHOT_PERMISSIONS_KEYS);
  const writeProject = safeEnum(valueAt(permissions, 'write_project'), WRITE_PROJECT_PERMISSIONS);
  if (route === 'build' ? writeProject !== 'route_required' : writeProject !== 'not_required_by_route') fail();
  if (
    valueAt(permissions, 'command_execution') !== 'not_available'
    || valueAt(permissions, 'external_network') !== 'not_available'
  ) fail();

  const workingBrief = valueAt(value, 'working_brief');
  assertExactObject(workingBrief, SNAPSHOT_WORKING_BRIEF_KEYS);
  const workingBriefAvailable = valueAt(workingBrief, 'available');
  const workingBriefSource = valueAt(workingBrief, 'source');
  const contextualReady = valueAt(workingBrief, 'contextual_build_ready');
  if (typeof workingBriefAvailable !== 'boolean' || typeof contextualReady !== 'boolean') fail();
  if (workingBriefAvailable) {
    safeEnum(workingBriefSource, WORKING_BRIEF_SOURCES);
  } else if (workingBriefSource !== null || contextualReady !== false) fail();

  const latestPlan = valueAt(value, 'latest_plan');
  assertExactObject(latestPlan, SNAPSHOT_LATEST_PLAN_KEYS);
  const latestPlanAvailable = valueAt(latestPlan, 'available');
  const latestPlanState = safeEnum(valueAt(latestPlan, 'state'), PLAN_STATES);
  if (
    typeof latestPlanAvailable !== 'boolean'
    || (latestPlanAvailable ? latestPlanState === 'none' : latestPlanState !== 'none')
  ) fail();
  const matchedSignals = sanitizeRouteSignals(valueAt(value, 'matched_signals'));
  if (valueAt(value, 'snapshot_version') !== BUILDER_BUILD_CONTEXT_SNAPSHOT_VERSION) fail();
  if (route !== 'build' || dispatch !== 'build') {
    if (executionBasis !== 'not_admitted') fail();
  } else if (executionBasis === 'not_admitted') {
    fail();
  } else if (executionBasis === 'approved_plan') {
    if (
      !latestPlanAvailable
      || latestPlanState !== 'approved'
      || !workingBriefAvailable
      || workingBriefSource !== 'approved_plan'
      || contextualReady !== true
    ) fail();
  } else if (executionBasis === 'task_brief') {
    if (!workingBriefAvailable || workingBriefSource !== 'task_capsule_update' || contextualReady !== true) fail();
  } else if (executionBasis === 'working_brief') {
    if (!workingBriefAvailable || contextualReady !== true) fail();
  } else if (executionBasis === 'current_artifact_defect') {
    if (!matchedSignals.includes('current_artifact_defect')) fail();
  } else if (executionBasis === 'missing_context_not_admitted') {
    if (
      !matchedSignals.includes('contextual_build')
      && !matchedSignals.includes('contextual_build_phrase')
    ) fail();
  }

  return freezeDeep({
    snapshot_version: BUILDER_BUILD_CONTEXT_SNAPSHOT_VERSION,
    route,
    dispatch,
    confidence: safeEnum(valueAt(value, 'confidence'), CONFIDENCES),
    matched_signals: matchedSignals,
    execution_basis: executionBasis,
    workspace_basis: safeEnum(valueAt(value, 'workspace_basis'), WORKSPACE_BASES),
    working_brief: {
      available: workingBriefAvailable,
      source: workingBriefSource,
      contextual_build_ready: contextualReady,
    },
    latest_plan: {
      available: latestPlanAvailable,
      state: latestPlanState,
    },
    permissions: {
      write_project: writeProject,
      command_execution: 'not_available',
      external_network: 'not_available',
    },
  });
}

module.exports = Object.freeze({
  BUILDER_BUILD_CONTEXT_SNAPSHOT_VERSION,
  BuilderBuildContextSnapshotError,
  createBuilderBuildContextSnapshot,
  sanitizeBuilderBuildContextSnapshot,
});
