'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderReviewStateProjection,
} = require('./builder-review-state-projection.cjs');

const BUILDER_AGENT_ACTIVITY_PROJECTION_VERSION = 'builder-agent-activity-projection.v1';
const INPUT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'head_sequence',
  'active_turn_id',
  'latest_run',
  'review_state_projection',
  'candidate_activity',
]);
const LATEST_RUN_KEYS = Object.freeze([
  'turn_id',
  'run_id',
  'status',
  'terminal_status',
  'result_kind',
  'route',
  'dispatch',
  'programming_run_admitted',
  'latest_progress_stage',
  'active_tool_action',
  'control',
  'plan_review',
  'candidate_review',
]);
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'project_id',
  'conversation_id',
  'head_sequence',
  'current',
  'authority',
]);
const CURRENT_KEYS = Object.freeze([
  'phase',
  'status',
  'label',
  'summary',
  'turn_id',
  'run_id',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'fact_source',
  'consumer_role',
  'side_effect_authority',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const ROUTES = Object.freeze(['answer', 'clarify', 'update_brief', 'plan', 'build']);
const DISPATCHES = Object.freeze([
  'reply', 'brief_update', 'plan', 'build', 'ask_workspace', 'ask_permission', 'blocked',
]);
const PROGRESS_STAGES = Object.freeze([
  'context_ready', 'provider_request_started', 'provider_response_received', 'result_preparing',
]);
const TOOL_ACTIONS = Object.freeze([
  'context.read', 'project.read', 'project.edit', 'secret.read', 'filesystem.read',
  'filesystem.write', 'network.request', 'process.spawn', 'publication.create',
  'permission.grant',
]);

const COPY = Object.freeze({
  preparing: Object.freeze({
    status: 'active',
    label: 'Preparing request',
    summary: 'Starting the current work.',
  }),
  reading_project: Object.freeze({
    status: 'active',
    label: 'Reading project',
    summary: 'Looking through the project files and current context.',
  }),
  planning: Object.freeze({
    status: 'active',
    label: 'Planning',
    summary: 'Turning the request into a plan you can review.',
  }),
  waiting_for_permission: Object.freeze({
    status: 'waiting',
    label: 'Waiting for approval',
    summary: 'Builder needs your approval before it can continue.',
  }),
  editing: Object.freeze({
    status: 'active',
    label: 'Changing files',
    summary: 'Applying the approved changes to the project.',
  }),
  running_local_step: Object.freeze({
    status: 'active',
    label: 'Running local step',
    summary: 'Running an approved local project command.',
  }),
  running_checks: Object.freeze({
    status: 'active',
    label: 'Running checks',
    summary: 'Checking the current draft before it is saved.',
  }),
  waiting_for_check: Object.freeze({
    status: 'waiting',
    label: 'Ready for review',
    summary: 'Run a check or skip it before saving.',
  }),
  preparing_review: Object.freeze({
    status: 'active',
    label: 'Preparing review',
    summary: 'Checking and organizing the result for review.',
  }),
  responding: Object.freeze({
    status: 'active',
    label: 'Writing response',
    summary: 'Preparing a response from the current project context.',
  }),
  stopping: Object.freeze({
    status: 'active',
    label: 'Stopping work',
    summary: 'Finishing the current step before stopping.',
  }),
  waiting_for_approval: Object.freeze({
    status: 'waiting',
    label: 'Plan ready',
    summary: 'Review the plan before Builder changes the project.',
  }),
  ready_to_execute: Object.freeze({
    status: 'ready',
    label: 'Ready to execute',
    summary: 'The approved plan is ready to run.',
  }),
  ready_for_review: Object.freeze({
    status: 'ready',
    label: 'Ready for review',
    summary: 'The recoverable draft is ready to inspect.',
  }),
  blocked: Object.freeze({
    status: 'blocked',
    label: 'Needs attention',
    summary: 'Builder could not finish this work.',
  }),
  finished: Object.freeze({
    status: 'complete',
    label: 'Finished',
    summary: 'This work is complete.',
  }),
});

class BuilderAgentActivityProjectionError extends Error {
  constructor() {
    super('Builder activity is unavailable.');
    this.name = 'BuilderAgentActivityProjectionError';
    this.code = 'builder_agent_activity_projection_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderAgentActivityProjectionError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
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

function safeNullable(value, allowed) {
  if (value === null) return null;
  if (!allowed.includes(value)) fail();
  return value;
}

function safeId(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeLatestRun(rawValue, activeTurnId) {
  if (rawValue === null) return null;
  const value = exactObject(rawValue, LATEST_RUN_KEYS);
  const status = valueAt(value, 'status');
  if (status !== 'running' && status !== 'completed') fail();
  const terminalStatus = safeNullable(valueAt(value, 'terminal_status'), [
    'succeeded', 'failed', 'interrupted', 'cancelled',
  ]);
  const resultKind = safeNullable(valueAt(value, 'result_kind'), [
    'explanation', 'plan', 'candidate', 'failure',
  ]);
  const turnId = safeId(valueAt(value, 'turn_id'), TURN_ID_PATTERN);
  if (status === 'running' && activeTurnId !== turnId) fail();
  if (
    status === 'completed'
    && activeTurnId !== null
    && (
      activeTurnId !== turnId
      || terminalStatus === 'succeeded'
    )
  ) fail();
  if (
    (status === 'running' && (terminalStatus !== null || resultKind !== null))
    || (status === 'completed' && (terminalStatus === null || resultKind === null))
  ) fail();
  const route = safeNullable(valueAt(value, 'route'), ROUTES);
  const dispatch = safeNullable(valueAt(value, 'dispatch'), DISPATCHES);
  if ((route === null) !== (dispatch === null)) fail();
  const programmingRunAdmitted = valueAt(value, 'programming_run_admitted');
  if (typeof programmingRunAdmitted !== 'boolean') fail();
  return freezeDeep({
    turn_id: turnId,
    run_id: safeId(valueAt(value, 'run_id'), RUN_ID_PATTERN),
    status,
    terminal_status: terminalStatus,
    result_kind: resultKind,
    route,
    dispatch,
    programming_run_admitted: programmingRunAdmitted,
    latest_progress_stage: safeNullable(valueAt(value, 'latest_progress_stage'), PROGRESS_STAGES),
    active_tool_action: safeNullable(valueAt(value, 'active_tool_action'), TOOL_ACTIONS),
    control: safeNullable(valueAt(value, 'control'), ['interrupt', 'cancel']),
    plan_review: safeNullable(valueAt(value, 'plan_review'), ['approved', 'rejected']),
    candidate_review: safeNullable(valueAt(value, 'candidate_review'), ['accepted', 'rejected']),
  });
}

function activePhase(run) {
  if (run.control !== null) return 'stopping';
  if (run.dispatch === 'ask_permission') return 'waiting_for_permission';
  if (run.active_tool_action === 'context.read'
    || run.active_tool_action === 'project.read'
    || run.active_tool_action === 'filesystem.read') return 'reading_project';
  if (run.active_tool_action === 'project.edit'
    || run.active_tool_action === 'filesystem.write') return 'editing';
  if (run.active_tool_action === 'process.spawn') return 'running_local_step';
  if (run.latest_progress_stage === 'context_ready') return 'reading_project';
  if (
    run.latest_progress_stage === 'provider_response_received'
    || run.latest_progress_stage === 'result_preparing'
  ) return 'preparing_review';
  if (run.route === 'plan') {
    return 'planning';
  }
  if (run.route === 'build') {
    return run.programming_run_admitted ? 'editing' : 'preparing';
  }
  if (run.route === 'answer' || run.route === 'clarify' || run.route === 'update_brief') {
    return 'responding';
  }
  return 'preparing';
}

function completedPhase(run) {
  if (run.terminal_status !== 'succeeded') return 'blocked';
  if (run.result_kind === 'plan') {
    if (run.plan_review === null) return 'waiting_for_approval';
    return run.plan_review === 'approved' ? 'ready_to_execute' : 'finished';
  }
  if (run.result_kind === 'candidate') {
    if (run.candidate_review === null) return 'preparing_review';
    return 'finished';
  }
  return 'finished';
}

function phaseFor(run, reviewStateProjection, activeTurnId, candidateActivity) {
  if (candidateActivity === 'check_run') return 'running_checks';
  if (reviewStateProjection !== null) {
    if (reviewStateProjection.status === 'ready') return 'ready_for_review';
    if (reviewStateProjection.blocking_reasons.includes('checkpoint_missing')) {
      return 'preparing_review';
    }
    if (reviewStateProjection.blocking_reasons.includes('check_running')) {
      return 'running_checks';
    }
    if (reviewStateProjection.blocking_reasons.includes('check_not_run')) {
      return 'waiting_for_check';
    }
    return 'blocked';
  }
  if (run === null) return activeTurnId === null ? 'finished' : 'preparing';
  return run.status === 'running' ? activePhase(run) : completedPhase(run);
}

function projectionAuthority(reviewStateProjection) {
  return freezeDeep({
    projection_authority: 'main_owned_agent_activity_projection_v1',
    fact_source: reviewStateProjection === null
      ? 'recorded_activity'
      : 'recorded_activity_and_review',
    consumer_role: 'read_only',
    side_effect_authority: 'none',
  });
}

function projectBuilderAgentActivity(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const projectId = safeId(valueAt(input, 'project_id'), PROJECT_ID_PATTERN);
    const conversationId = safeId(valueAt(input, 'conversation_id'), CONVERSATION_ID_PATTERN);
    if (conversationId.slice('builder-conversation:'.length)
      !== projectId.slice('builder-project:'.length)) fail();
    const headSequence = valueAt(input, 'head_sequence');
    if (!Number.isSafeInteger(headSequence) || headSequence < 1 || headSequence > 1_000_000) fail();
    const activeTurnIdRaw = valueAt(input, 'active_turn_id');
    const activeTurnId = activeTurnIdRaw === null
      ? null
      : safeId(activeTurnIdRaw, TURN_ID_PATTERN);
    const run = safeLatestRun(valueAt(input, 'latest_run'), activeTurnId);
    const reviewStateRaw = valueAt(input, 'review_state_projection');
    const reviewStateProjection = reviewStateRaw === null
      ? null
      : sanitizeBuilderReviewStateProjection(reviewStateRaw);
    if (reviewStateProjection !== null && run?.result_kind !== 'candidate') fail();
    const candidateActivity = safeNullable(valueAt(input, 'candidate_activity'), ['check_run']);
    if (candidateActivity !== null && run?.result_kind !== 'candidate') fail();
    const phase = phaseFor(run, reviewStateProjection, activeTurnId, candidateActivity);
    const copy = COPY[phase];
    if (!copy) fail();
    const current = {
      phase,
      status: copy.status,
      label: copy.label,
      summary: reviewStateProjection === null ? copy.summary : reviewStateProjection.summary,
      turn_id: run?.turn_id ?? null,
      run_id: run?.run_id ?? null,
    };
    return freezeDeep({
      projection_version: BUILDER_AGENT_ACTIVITY_PROJECTION_VERSION,
      project_id: projectId,
      conversation_id: conversationId,
      head_sequence: headSequence,
      current,
      authority: projectionAuthority(reviewStateProjection),
    });
  } catch (error) {
    if (error instanceof BuilderAgentActivityProjectionError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentActivityProjection(rawValue) {
  try {
    const value = exactObject(rawValue, PROJECTION_KEYS);
    const current = exactObject(valueAt(value, 'current'), CURRENT_KEYS);
    const authority = exactObject(valueAt(value, 'authority'), AUTHORITY_KEYS);
    const phase = valueAt(current, 'phase');
    const copy = COPY[phase];
    if (!copy) fail();
    const projectId = safeId(valueAt(value, 'project_id'), PROJECT_ID_PATTERN);
    const conversationId = safeId(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN);
    if (
      valueAt(value, 'projection_version') !== BUILDER_AGENT_ACTIVITY_PROJECTION_VERSION
      || conversationId.slice('builder-conversation:'.length)
        !== projectId.slice('builder-project:'.length)
      || !Number.isSafeInteger(valueAt(value, 'head_sequence'))
      || valueAt(value, 'head_sequence') < 1
      || valueAt(current, 'status') !== copy.status
      || valueAt(current, 'label') !== copy.label
      || typeof valueAt(current, 'summary') !== 'string'
      || valueAt(current, 'summary').length < 1
      || valueAt(current, 'summary').length > 240
    ) fail();
    const turnId = valueAt(current, 'turn_id');
    const runId = valueAt(current, 'run_id');
    if ((turnId === null) !== (runId === null)) fail();
    if (turnId !== null) safeId(turnId, TURN_ID_PATTERN);
    if (runId !== null) safeId(runId, RUN_ID_PATTERN);
    const expectedAuthority = projectionAuthority(
      valueAt(authority, 'fact_source') === 'recorded_activity' ? null : {},
    );
    for (const key of AUTHORITY_KEYS) {
      if (valueAt(authority, key) !== valueAt(expectedAuthority, key)) fail();
    }
    return freezeDeep(value);
  } catch (error) {
    if (error instanceof BuilderAgentActivityProjectionError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_AGENT_ACTIVITY_PROJECTION_VERSION,
  BuilderAgentActivityProjectionError,
  projectBuilderAgentActivity,
  sanitizeBuilderAgentActivityProjection,
});
