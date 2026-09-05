import {
  sanitizeBuilderAgentTaskMonitorProjection,
  type BuilderAgentTaskMonitorProjection,
} from './builderAgentTaskMonitorProjection';

export type BuilderAgentWorkbenchTaskProposalAction = Readonly<{
  action_version: 'builder-workbench-task-proposal-action.v1';
  action_id: string;
  proposal_id: string;
  status: 'pending' | 'rejected' | 'materialized';
  objective: string;
  requested_outcome: 'discuss' | 'plan' | 'build' | 'review' | 'research' | 'monitor';
  execution_mode: 'foreground' | 'parallel';
  project_id: string | null;
  task_address_id: string | null;
  conversation_id: string | null;
  operations: readonly ('approve_existing_project' | 'reject' | 'open_task')[];
}>;

export type BuilderAgentWorkbenchMessage = Readonly<{
  message_id: string;
  thread_id: string | null;
  presentation_family: 'conversation' | 'proposal' | 'status' | 'result' | 'system' | 'generic';
  content_type: string;
  source_label: string;
  fallback_text: string;
  presentation: Readonly<{
    presentation_version: 'builder-workbench-declarative-presentation.v1';
    body_kind: 'plain_text' | 'markdown';
    body_text: string;
    metadata: readonly unknown[];
  }>;
  attention: 'normal' | 'mention' | 'action_required' | 'urgent';
  trust_label: 'local' | 'verified' | 'external' | 'untrusted';
  state: Readonly<{
    unread: boolean;
    acknowledged: boolean;
    archived: boolean;
  }>;
  actions: readonly BuilderAgentWorkbenchTaskProposalAction[];
  task_ref: Readonly<{
    project_id: string;
    task_address_id: string;
    operation: 'open_task';
  }> | null;
  created_at_ms: number;
}>;

export type BuilderAgentPlanProjection = Readonly<{
  status: 'ready';
  artifact: Readonly<{
    artifact_version: 'builder-agent-plan-artifact.v1';
    content_digest: string;
    agent_plan_id: string;
    agent_id: string;
    source_conversation_id: string;
    source_turn_id: string;
    source_run_id: string;
    source_message_id: string;
    version: number;
    markdown: string;
    state: 'proposed';
    created_at_ms: number;
  }>;
  decision: Readonly<{
    decision_version: 'builder-agent-plan-decision.v1';
    decision_digest: string;
    agent_plan_id: string;
    content_digest: string;
    decision: 'approved' | 'rejected';
    decided_by: string;
    decided_at_ms: number;
  }> | null;
}>;

export type BuilderAgentWorkbenchProjection = Readonly<{
  projection_version: 'builder-agent-workbench-projection.v2';
  agent_id: string;
  stream: Readonly<{
    items: readonly BuilderAgentWorkbenchMessage[];
    after_cursor: string | null;
    next_cursor: string | null;
    has_more: boolean;
  }>;
  task_monitor: BuilderAgentTaskMonitorProjection;
  agent_plan?: BuilderAgentPlanProjection | null;
  inbox: Readonly<{
    unread_count: number;
    action_required_count: number;
    mention_count: number;
    active_task_count: number;
  }>;
  authority: Readonly<{
    canonical_messages: 'main_owned_workbench_message_store';
    user_state: 'main_owned_workbench_message_state_store';
    task_state: 'sqlite_canonical_event_replay_plus_task_attention';
    renderer_authority: 'selection_and_bounded_state_requests_only';
    plugin_payload_exposure: 'not_exposed';
    permission_grant: false;
    provider_dispatch: false;
    source_read: false;
    source_write: false;
  }>;
}>;

export class BuilderAgentWorkbenchProjectionError extends Error {
  readonly code = 'builder_agent_workbench_projection_invalid';
  constructor() {
    super('Agent Workbench could not be verified.');
    this.name = 'BuilderAgentWorkbenchProjectionError';
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const AGENT_ID = new RegExp(`^builder-agent:${UUID}$`, 'u');
const MESSAGE_ID = new RegExp(`^builder-message:${UUID}$`, 'u');
const THREAD_ID = new RegExp(`^builder-workbench-thread:${UUID}$`, 'u');
const CURSOR = /^builder-workbench-cursor:[1-9][0-9]*$/u;
const CONTENT_TYPE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+\.v[1-9][0-9]*$/u;
const ACTION_ID = /^builder-workbench-action:[0-9a-f]{64}$/u;
const PROPOSAL_ID = new RegExp(`^builder-task-proposal:${UUID}$`, 'u');
const PROJECT_ID = new RegExp(`^builder-project:${UUID}$`, 'u');
const TASK_ID = new RegExp(`^builder-task-address:${UUID}$`, 'u');
const CONVERSATION_ID = new RegExp(`^builder-conversation:${UUID}:${UUID}$`, 'u');
const AGENT_CONVERSATION_ID = new RegExp(`^builder-agent-conversation:${UUID}$`, 'u');
const TURN_ID = new RegExp(`^builder-turn:${UUID}$`, 'u');
const RUN_ID = new RegExp(`^builder-run:${UUID}$`, 'u');
const AGENT_PLAN_ID = new RegExp(`^builder-agent-plan:${UUID}$`, 'u');
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

function invalid(): never { throw new BuilderAgentWorkbenchProjectionError(); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    output[key] = descriptor.value;
  }
  return output;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) invalid();
  return value;
}
function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.length === 0)) invalid();
  return value;
}
function identifier(value: unknown, pattern: RegExp): string {
  const output = text(value, 160);
  if (!pattern.test(output)) invalid();
  return output;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}
function cursor(value: unknown): string | null {
  if (value === null) return null;
  return identifier(value, CURSOR);
}
function count(value: unknown): number { return integer(value); }

function nullableIdentifier(value: unknown, pattern: RegExp): string | null {
  return value === null ? null : identifier(value, pattern);
}

function action(value: unknown): BuilderAgentWorkbenchTaskProposalAction {
  const source = record(value, [
    'action_version', 'action_id', 'proposal_id', 'status', 'objective', 'requested_outcome',
    'execution_mode', 'project_id', 'task_address_id', 'conversation_id', 'operations',
  ]);
  const statuses = ['pending', 'rejected', 'materialized'] as const;
  const outcomes = ['discuss', 'plan', 'build', 'review', 'research', 'monitor'] as const;
  const modes = ['foreground', 'parallel'] as const;
  const allowedOperations = ['approve_existing_project', 'reject', 'open_task'] as const;
  if (
    source.action_version !== 'builder-workbench-task-proposal-action.v1'
    || !statuses.includes(source.status as typeof statuses[number])
    || !outcomes.includes(source.requested_outcome as typeof outcomes[number])
    || !modes.includes(source.execution_mode as typeof modes[number])
  ) invalid();
  const operations = array(source.operations, 3).map((operation) => {
    if (!allowedOperations.includes(operation as typeof allowedOperations[number])) invalid();
    return operation as typeof allowedOperations[number];
  });
  return Object.freeze({
    action_version: 'builder-workbench-task-proposal-action.v1',
    action_id: identifier(source.action_id, ACTION_ID),
    proposal_id: identifier(source.proposal_id, PROPOSAL_ID),
    status: source.status as BuilderAgentWorkbenchTaskProposalAction['status'],
    objective: text(source.objective, 2_048),
    requested_outcome: source.requested_outcome as BuilderAgentWorkbenchTaskProposalAction['requested_outcome'],
    execution_mode: source.execution_mode as BuilderAgentWorkbenchTaskProposalAction['execution_mode'],
    project_id: nullableIdentifier(source.project_id, PROJECT_ID),
    task_address_id: nullableIdentifier(source.task_address_id, TASK_ID),
    conversation_id: nullableIdentifier(source.conversation_id, CONVERSATION_ID),
    operations: Object.freeze(operations),
  });
}

function message(value: unknown): BuilderAgentWorkbenchMessage {
  const source = record(value, [
    'message_id', 'thread_id', 'presentation_family', 'content_type', 'source_label',
    'fallback_text', 'presentation', 'attention', 'trust_label', 'state', 'actions',
    'task_ref', 'created_at_ms',
  ]);
  const families = ['conversation', 'proposal', 'status', 'result', 'system', 'generic'] as const;
  const attentions = ['normal', 'mention', 'action_required', 'urgent'] as const;
  const trustLabels = ['local', 'verified', 'external', 'untrusted'] as const;
  if (!families.includes(source.presentation_family as typeof families[number])) invalid();
  if (!attentions.includes(source.attention as typeof attentions[number])) invalid();
  if (!trustLabels.includes(source.trust_label as typeof trustLabels[number])) invalid();
  const presentation = record(source.presentation, [
    'presentation_version', 'body_kind', 'body_text', 'metadata',
  ]);
  if (
    presentation.presentation_version !== 'builder-workbench-declarative-presentation.v1'
    || (presentation.body_kind !== 'plain_text' && presentation.body_kind !== 'markdown')
    || array(presentation.metadata, 0).length !== 0
  ) invalid();
  const state = record(source.state, ['unread', 'acknowledged', 'archived']);
  if (
    typeof state.unread !== 'boolean'
    || typeof state.acknowledged !== 'boolean'
    || typeof state.archived !== 'boolean'
  ) invalid();
  return Object.freeze({
    message_id: identifier(source.message_id, MESSAGE_ID),
    thread_id: source.thread_id === null ? null : identifier(source.thread_id, THREAD_ID),
    presentation_family: source.presentation_family as BuilderAgentWorkbenchMessage['presentation_family'],
    content_type: identifier(source.content_type, CONTENT_TYPE),
    source_label: text(source.source_label, 80),
    fallback_text: text(source.fallback_text, 32_768, true),
    presentation: Object.freeze({
      presentation_version: 'builder-workbench-declarative-presentation.v1',
      body_kind: presentation.body_kind,
      body_text: text(presentation.body_text, 32_768, true),
      metadata: Object.freeze([]),
    }) as BuilderAgentWorkbenchMessage['presentation'],
    attention: source.attention as BuilderAgentWorkbenchMessage['attention'],
    trust_label: source.trust_label as BuilderAgentWorkbenchMessage['trust_label'],
    state: Object.freeze({
      unread: state.unread,
      acknowledged: state.acknowledged,
      archived: state.archived,
    }) as BuilderAgentWorkbenchMessage['state'],
    actions: Object.freeze(array(source.actions, 8).map(action)),
    task_ref: source.task_ref === null ? null : (() => {
      const taskRef = record(source.task_ref, ['project_id', 'task_address_id', 'operation']);
      if (taskRef.operation !== 'open_task') invalid();
      return Object.freeze({
        project_id: identifier(taskRef.project_id, PROJECT_ID),
        task_address_id: identifier(taskRef.task_address_id, TASK_ID),
        operation: 'open_task' as const,
      });
    })(),
    created_at_ms: integer(source.created_at_ms),
  });
}

function agentPlan(value: unknown): BuilderAgentPlanProjection | null {
  if (value === null) return null;
  const bundle = record(value, ['status', 'artifact', 'decision']);
  if (bundle.status !== 'ready') invalid();
  const artifact = record(bundle.artifact, [
    'artifact_version', 'content_digest', 'agent_plan_id', 'agent_id', 'source_conversation_id',
    'source_turn_id', 'source_run_id', 'source_message_id', 'version', 'markdown', 'state', 'created_at_ms',
  ]);
  if (artifact.artifact_version !== 'builder-agent-plan-artifact.v1' || artifact.state !== 'proposed') invalid();
  const sanitizedArtifact = Object.freeze({
    artifact_version: 'builder-agent-plan-artifact.v1' as const,
    content_digest: identifier(artifact.content_digest, DIGEST),
    agent_plan_id: identifier(artifact.agent_plan_id, AGENT_PLAN_ID),
    agent_id: identifier(artifact.agent_id, AGENT_ID),
    source_conversation_id: identifier(artifact.source_conversation_id, AGENT_CONVERSATION_ID),
    source_turn_id: identifier(artifact.source_turn_id, TURN_ID),
    source_run_id: identifier(artifact.source_run_id, RUN_ID),
    source_message_id: identifier(artifact.source_message_id, MESSAGE_ID),
    version: integer(artifact.version),
    markdown: text(artifact.markdown, 128_000),
    state: 'proposed' as const,
    created_at_ms: integer(artifact.created_at_ms),
  });
  let sanitizedDecision: BuilderAgentPlanProjection['decision'] = null;
  if (bundle.decision !== null) {
    const decision = record(bundle.decision, [
      'decision_version', 'decision_digest', 'agent_plan_id', 'content_digest',
      'decision', 'decided_by', 'decided_at_ms',
    ]);
    if (
      decision.decision_version !== 'builder-agent-plan-decision.v1'
      || (decision.decision !== 'approved' && decision.decision !== 'rejected')
      || decision.agent_plan_id !== sanitizedArtifact.agent_plan_id
      || decision.content_digest !== sanitizedArtifact.content_digest
    ) invalid();
    sanitizedDecision = Object.freeze({
      decision_version: 'builder-agent-plan-decision.v1',
      decision_digest: identifier(decision.decision_digest, DIGEST),
      agent_plan_id: identifier(decision.agent_plan_id, AGENT_PLAN_ID),
      content_digest: identifier(decision.content_digest, DIGEST),
      decision: decision.decision,
      decided_by: text(decision.decided_by, 80),
      decided_at_ms: integer(decision.decided_at_ms),
    });
  }
  return Object.freeze({ status: 'ready', artifact: sanitizedArtifact, decision: sanitizedDecision });
}

export function sanitizeBuilderAgentWorkbenchProjection(
  value: unknown,
): BuilderAgentWorkbenchProjection {
  const hasAgentPlan = value !== null && typeof value === 'object' && Object.hasOwn(value, 'agent_plan');
  const source = record(value, [
    'projection_version', 'agent_id', 'stream', 'task_monitor',
    ...(hasAgentPlan ? ['agent_plan'] : []), 'inbox', 'authority',
  ]);
  if (source.projection_version !== 'builder-agent-workbench-projection.v2') invalid();
  const stream = record(source.stream, ['items', 'after_cursor', 'next_cursor', 'has_more']);
  const inbox = record(source.inbox, [
    'unread_count', 'action_required_count', 'mention_count', 'active_task_count',
  ]);
  const authority = record(source.authority, [
    'canonical_messages', 'user_state', 'task_state', 'renderer_authority', 'plugin_payload_exposure',
    'permission_grant', 'provider_dispatch', 'source_read', 'source_write',
  ]);
  if (
    typeof stream.has_more !== 'boolean'
    || authority.canonical_messages !== 'main_owned_workbench_message_store'
    || authority.user_state !== 'main_owned_workbench_message_state_store'
    || authority.task_state !== 'sqlite_canonical_event_replay_plus_task_attention'
    || authority.renderer_authority !== 'selection_and_bounded_state_requests_only'
    || authority.plugin_payload_exposure !== 'not_exposed'
    || authority.permission_grant !== false
    || authority.provider_dispatch !== false
    || authority.source_read !== false
    || authority.source_write !== false
  ) invalid();
  return Object.freeze({
    projection_version: 'builder-agent-workbench-projection.v2',
    agent_id: identifier(source.agent_id, AGENT_ID),
    stream: Object.freeze({
      items: Object.freeze(array(stream.items, 200).map(message)),
      after_cursor: cursor(stream.after_cursor),
      next_cursor: cursor(stream.next_cursor),
      has_more: stream.has_more,
    }),
    task_monitor: sanitizeBuilderAgentTaskMonitorProjection(source.task_monitor),
    ...(hasAgentPlan ? { agent_plan: agentPlan(source.agent_plan) } : {}),
    inbox: Object.freeze({
      unread_count: count(inbox.unread_count),
      action_required_count: count(inbox.action_required_count),
      mention_count: count(inbox.mention_count),
      active_task_count: count(inbox.active_task_count),
    }),
    authority: Object.freeze({
      canonical_messages: 'main_owned_workbench_message_store',
      user_state: 'main_owned_workbench_message_state_store',
      task_state: 'sqlite_canonical_event_replay_plus_task_attention',
      renderer_authority: 'selection_and_bounded_state_requests_only',
      plugin_payload_exposure: 'not_exposed',
      permission_grant: false,
      provider_dispatch: false,
      source_read: false,
      source_write: false,
    }),
  });
}
