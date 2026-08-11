import {
  sanitizeBuilderContextStatusProjectionWire,
  type BuilderContextStatusProjectionWire,
} from './builderContextStatusProjection';
import {
  sanitizeBuilderProviderContextDisclosureStatusProjectionWire,
  type BuilderProviderContextDisclosureStatusProjectionWire,
} from './builderProviderContextDisclosureStatusProjection';
import {
  sanitizeBuilderDraftCheckpointStatusProjectionWire,
  type BuilderDraftCheckpointStatusProjectionWire,
} from './builderDraftCheckpointStatusProjection';
import {
  sanitizeBuilderReviewStateProjectionWire,
  type BuilderReviewStateProjectionWire,
} from './builderReviewStateProjection';
import {
  sanitizeBuilderAgentActivityProjectionWire,
  type BuilderAgentActivityProjectionWire,
} from './builderAgentActivityProjection';
import {
  sanitizeBuilderCheckRunOutcomeProjectionWire,
  type BuilderCheckRunOutcomeProjectionWire,
} from './builderCheckRunOutcomeProjection';

export const BUILDER_TASK_STREAM_READ_RESULT_VERSION =
  'builder-task-stream-read-result.v1' as const;

export type BuilderConversationAuthority = Readonly<{
  conversation: 'sqlite_canonical_event_replay_or_absent';
  project_source: 'not_included';
  candidate_source: 'not_loaded';
  project_revision: 'not_inferred';
}>;

export type BuilderConversationMessage = Readonly<{
  message_id: string;
  text: string;
}>;

export type BuilderConversationTask = Readonly<{
  task_id: string;
  title: string;
}>;

export type BuilderConversationCandidate = Readonly<{
  draft_id: string;
  title: string;
  summary: string;
  candidate_state: 'proposed';
  source_availability: 'not_loaded';
}>;

export type BuilderConversationSavedRevision = Readonly<{
  revision_number: number;
}>;

export type BuilderConversationTaskBrief = Readonly<{
  status: 'discussing' | 'ready';
  summary: string;
  contextual_build_ready: boolean;
}>;

export type BuilderConversationToolAction =
  | 'context.read'
  | 'project.read'
  | 'project.edit'
  | 'secret.read'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'network.request'
  | 'process.spawn'
  | 'publication.create'
  | 'permission.grant';

export type BuilderConversationToolResourceKind =
  | 'project'
  | 'conversation'
  | 'task'
  | 'run'
  | 'revision'
  | 'artifact'
  | 'secret'
  | 'filesystem'
  | 'network'
  | 'process'
  | 'publication'
  | 'permission';

export type BuilderConversationToolCallLifecycle = Readonly<{
  permission_admission: 'verified_allowed';
  dispatch_admission: 'not_started';
  execution_admission: 'not_performed';
  result_admission: 'not_recorded';
}>;

export type BuilderConversationToolResultStatus =
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type BuilderConversationToolResultSummaryCode =
  | 'completed_without_raw_output'
  | 'failed_without_raw_output'
  | 'output_rejected'
  | 'adapter_unavailable'
  | 'timed_out_without_raw_output'
  | 'cancelled_without_raw_output';

export type BuilderConversationToolResult = Readonly<{
  status: BuilderConversationToolResultStatus;
  summary_code: BuilderConversationToolResultSummaryCode;
  display_summary: string;
}>;

export type BuilderConversationToolResultLifecycle = Readonly<{
  result_admission: 'fixed_summary_code_recorded';
  raw_output_admission: 'not_included';
  revision_admission: 'not_created';
}>;

export type BuilderConversationRunProgressStage =
  | 'context_ready'
  | 'provider_request_started'
  | 'provider_response_received'
  | 'result_preparing';

export type BuilderConversationAgentStepResultStatus =
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type BuilderConversationAgentStepResultSummaryCode =
  | 'agent_step_completed_without_raw_output'
  | 'agent_step_needs_owner_attention'
  | 'agent_step_failed_without_raw_output'
  | 'agent_step_cancelled_without_raw_output';

export type BuilderConversationAgentStepResult = Readonly<{
  status: BuilderConversationAgentStepResultStatus;
  summary_code: BuilderConversationAgentStepResultSummaryCode;
  display_summary: string;
}>;

export type BuilderConversationAgentStepSummary = Readonly<{
  status: 'started' | BuilderConversationAgentStepResultStatus;
  display_summary: string;
}>;

export type BuilderConversationAgentStepLifecycle = Readonly<{
  conversation_admission: 'verified_public_progress';
  raw_output_admission: 'not_included';
  revision_admission: 'not_created';
}>;

export type BuilderConversationFailurePhase =
  | 'not_applicable'
  | 'not_recorded'
  | BuilderConversationRunProgressStage;

export type BuilderConversationItem =
  | Readonly<{
    item_kind: 'user_message';
    sequence: number;
    turn_id: string;
    message: BuilderConversationMessage;
    message_kind: 'submitted' | 'steering' | 'queued_followup';
    mode: 'question' | 'work' | null;
    task: BuilderConversationTask | null;
  }>
  | Readonly<{
    item_kind: 'queued_followup_consumed';
    sequence: number;
    turn_id: string;
    run_id: string;
    message_id: string;
    consumed_by: Readonly<{
      turn_id: string;
      message_id: string;
    }>;
    recorded_state: 'consumed';
  }>
  | Readonly<{
    item_kind: 'run_started';
    sequence: number;
    turn_id: string;
    run_id: string;
    task_id: string | null;
    attempt_number: number;
    retry_of_run_id: string | null;
    recorded_state: 'started';
  }>
  | Readonly<{
    item_kind: 'run_context_snapshot_recorded';
    sequence: number;
    turn_id: string;
    run_id: string;
    task_id: string | null;
    context: Readonly<{
      recorded_state: 'recorded';
      route: 'answer' | 'clarify' | 'update_brief' | 'plan' | 'build';
      dispatch: 'reply' | 'brief_update' | 'plan' | 'build' | 'ask_workspace' | 'ask_permission' | 'blocked';
      downgraded_from: 'answer' | 'clarify' | 'update_brief' | 'plan' | 'build' | null;
      downgrade_reason: 'ambiguous_build_intent' | 'missing_prior_build_context' | 'workspace_required' | null;
      brief: 'available' | 'not_available';
      base: 'new_project_or_unsaved' | 'project_revision';
      permission_result: 'not_required' | 'allowed' | 'ask' | 'denied';
      command_execution: 'not_included';
      network_access: 'not_included';
    }>;
  }>
  | Readonly<{
    item_kind: 'programming_run_admitted';
    sequence: number;
    turn_id: string;
    run_id: string;
    task_id: string;
    recorded_state: 'admitted';
  }>
  | Readonly<{
    item_kind: 'run_progress_recorded';
    sequence: number;
    turn_id: string;
    run_id: string;
    stage: BuilderConversationRunProgressStage;
    recorded_state: 'recorded';
  }>
  | Readonly<{
    item_kind: 'agent_step_progress_recorded';
    sequence: number;
    turn_id: string;
    run_id: string;
    task_id: string;
    step_id: string;
    step_index: number;
    recorded_state: 'start_recorded' | 'result_recorded';
    result: BuilderConversationAgentStepResult | null;
    summary: BuilderConversationAgentStepSummary;
    lifecycle: BuilderConversationAgentStepLifecycle;
  }>
  | Readonly<{
    item_kind: 'run_control_requested';
    sequence: number;
    turn_id: string;
    run_id: string;
    action: 'cancel' | 'interrupt';
  }>
  | Readonly<{
    item_kind: 'task_brief_updated';
    sequence: number;
    turn_id: string;
    run_id: string;
    task: BuilderConversationTask;
    brief: BuilderConversationTaskBrief;
    recorded_state: 'updated';
  }>
  | Readonly<{
    item_kind: 'tool_call_requested';
    sequence: number;
    turn_id: string;
    run_id: string;
    step_id: string;
    tool_call_id: string;
    tool_label: string;
    action: BuilderConversationToolAction;
    resource: Readonly<{
      resource_kind: BuilderConversationToolResourceKind;
    }>;
    lifecycle: BuilderConversationToolCallLifecycle;
    recorded_state: 'requested';
  }>
  | Readonly<{
    item_kind: 'tool_call_result_recorded';
    sequence: number;
    turn_id: string;
    run_id: string;
    step_id: string;
    tool_call_id: string;
    tool_label: string;
    action: BuilderConversationToolAction;
    resource: Readonly<{
      resource_kind: BuilderConversationToolResourceKind;
    }>;
    result: BuilderConversationToolResult;
    lifecycle: BuilderConversationToolResultLifecycle;
    recorded_state: 'recorded';
  }>
  | Readonly<{
    item_kind: 'run_completed';
    sequence: number;
    turn_id: string;
    run_id: string;
    terminal_status: 'succeeded' | 'failed' | 'interrupted' | 'cancelled';
    result_kind: 'explanation' | 'plan' | 'candidate' | 'failure';
    failure_phase: BuilderConversationFailurePhase;
    assistant_message: BuilderConversationMessage | null;
    candidate: BuilderConversationCandidate | null;
  }>
  | Readonly<{
    item_kind: 'candidate_reviewed';
    sequence: number;
    turn_id: string;
    run_id: string;
    draft_id: string;
    decision: 'accepted' | 'rejected';
    candidate_state: 'saved' | 'rejected';
    saved_revision: BuilderConversationSavedRevision | null;
  }>
  | Readonly<{
    item_kind: 'plan_reviewed';
    sequence: number;
    turn_id: string;
    run_id: string;
    decision: 'approved' | 'rejected';
    plan_state: 'approved' | 'rejected';
  }>
  | Readonly<{
    item_kind: 'turn_completed';
    sequence: number;
    turn_id: string;
    run_id: string | null;
    outcome:
      | 'answered'
      | 'responded'
      | 'plan_proposed'
      | 'candidate_ready'
      | 'failed'
      | 'interrupted'
      | 'cancelled';
  }>;

export type BuilderConversationReadySnapshot = Readonly<{
  state: 'ready';
  stream_version: typeof BUILDER_TASK_STREAM_READ_RESULT_VERSION;
  project_id: string;
  context_status_projection?: BuilderContextStatusProjectionWire | null;
  provider_context_disclosure_status_projection?:
    | BuilderProviderContextDisclosureStatusProjectionWire
    | null;
  draft_checkpoint_status_projection?: BuilderDraftCheckpointStatusProjectionWire | null;
  review_state_projection?: BuilderReviewStateProjectionWire | null;
  check_run_outcome_projection?: BuilderCheckRunOutcomeProjectionWire | null;
  agent_activity_projection?: BuilderAgentActivityProjectionWire | null;
  conversation: Readonly<{
    conversation_id: string;
    created_at_ms: number;
    head_sequence: number;
    recorded_active_turn_id: string | null;
    window: Readonly<{
      first_sequence: number;
      last_sequence: number;
      has_earlier: boolean;
    }>;
    items: readonly BuilderConversationItem[];
  }>;
  authority: BuilderConversationAuthority;
}>;

export type BuilderConversationAbsentSnapshot = Readonly<{
  state: 'absent';
  stream_version: typeof BUILDER_TASK_STREAM_READ_RESULT_VERSION;
  project_id: string;
  context_status_projection?: BuilderContextStatusProjectionWire | null;
  provider_context_disclosure_status_projection?:
    | BuilderProviderContextDisclosureStatusProjectionWire
    | null;
  draft_checkpoint_status_projection?: BuilderDraftCheckpointStatusProjectionWire | null;
  review_state_projection?: BuilderReviewStateProjectionWire | null;
  check_run_outcome_projection?: BuilderCheckRunOutcomeProjectionWire | null;
  agent_activity_projection?: BuilderAgentActivityProjectionWire | null;
  conversation: null;
  authority: BuilderConversationAuthority;
}>;

export type BuilderConversationSnapshot =
  | BuilderConversationAbsentSnapshot
  | BuilderConversationReadySnapshot;

const MAX_PUBLIC_ITEMS = 128;
const MAX_PUBLIC_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_SEQUENCE = 1024;
const MAX_MESSAGE_CODE_POINTS = 8192;
const MAX_MESSAGE_UTF8_BYTES = 16 * 1024;
const TEXT_ENCODER = new TextEncoder();

const UUID_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const TOOL_CALL_ID_PATTERN = new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u');
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN =
  /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_PATTERN =
  /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;

const TOP_LEVEL_KEYS = Object.freeze([
  'stream_version',
  'project_id',
  'conversation',
  'authority',
]);
const TOP_LEVEL_OPTIONAL_KEYS = Object.freeze([
  'context_status_projection',
  'provider_context_disclosure_status_projection',
  'draft_checkpoint_status_projection',
  'review_state_projection',
  'check_run_outcome_projection',
  'agent_activity_projection',
]);
const AUTHORITY_KEYS = Object.freeze([
  'conversation',
  'project_source',
  'candidate_source',
  'project_revision',
]);
const CONVERSATION_KEYS = Object.freeze([
  'conversation_id',
  'created_at_ms',
  'head_sequence',
  'recorded_active_turn_id',
  'window',
  'items',
]);
const WINDOW_KEYS = Object.freeze([
  'first_sequence',
  'last_sequence',
  'has_earlier',
]);
const USER_MESSAGE_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'message',
  'message_kind',
  'mode',
  'task',
]);
const QUEUED_FOLLOWUP_CONSUMED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'message_id',
  'consumed_by',
  'recorded_state',
]);
const QUEUED_FOLLOWUP_CONSUMED_BY_KEYS = Object.freeze([
  'turn_id',
  'message_id',
]);
const RUN_STARTED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'task_id',
  'attempt_number',
  'retry_of_run_id',
  'recorded_state',
]);
const RUN_CONTEXT_SNAPSHOT_RECORDED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'task_id',
  'context',
]);
const RUN_CONTEXT_SNAPSHOT_CONTEXT_KEYS = Object.freeze([
  'recorded_state',
  'route',
  'dispatch',
  'downgraded_from',
  'downgrade_reason',
  'brief',
  'base',
  'permission_result',
  'command_execution',
  'network_access',
]);
const PROGRAMMING_RUN_ADMITTED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'task_id',
  'recorded_state',
]);
const RUN_CONTROL_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'action',
]);
const RUN_PROGRESS_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'stage',
  'recorded_state',
]);
const AGENT_STEP_PROGRESS_RECORDED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'task_id',
  'step_id',
  'step_index',
  'recorded_state',
  'result',
  'summary',
  'lifecycle',
]);
const AGENT_STEP_RESULT_KEYS = Object.freeze([
  'status',
  'summary_code',
  'display_summary',
]);
const AGENT_STEP_SUMMARY_KEYS = Object.freeze([
  'status',
  'display_summary',
]);
const AGENT_STEP_LIFECYCLE_KEYS = Object.freeze([
  'conversation_admission',
  'raw_output_admission',
  'revision_admission',
]);
const TASK_BRIEF_UPDATED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'task',
  'brief',
  'recorded_state',
]);
const TOOL_CALL_REQUESTED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'step_id',
  'tool_call_id',
  'tool_label',
  'action',
  'resource',
  'lifecycle',
  'recorded_state',
]);
const TOOL_CALL_RESULT_RECORDED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'step_id',
  'tool_call_id',
  'tool_label',
  'action',
  'resource',
  'result',
  'lifecycle',
  'recorded_state',
]);
const TOOL_RESOURCE_KEYS = Object.freeze(['resource_kind']);
const TOOL_LIFECYCLE_KEYS = Object.freeze([
  'permission_admission',
  'dispatch_admission',
  'execution_admission',
  'result_admission',
]);
const TOOL_RESULT_KEYS = Object.freeze([
  'status',
  'summary_code',
  'display_summary',
]);
const TOOL_RESULT_LIFECYCLE_KEYS = Object.freeze([
  'result_admission',
  'raw_output_admission',
  'revision_admission',
]);
const TOOL_LABEL_BY_ACTION: Readonly<Record<BuilderConversationToolAction, string>> = Object.freeze({
  'context.read': 'Read project context',
  'project.read': 'Read project context',
  'project.edit': 'Prepare project edit',
  'secret.read': 'Use saved secret',
  'filesystem.read': 'Read project file',
  'filesystem.write': 'Prepare file change',
  'network.request': 'Use network',
  'process.spawn': 'Run local command',
  'publication.create': 'Prepare publish',
  'permission.grant': 'Change access',
});
const RUN_PROGRESS_STAGES: readonly BuilderConversationRunProgressStage[] = Object.freeze([
  'context_ready',
  'provider_request_started',
  'provider_response_received',
  'result_preparing',
]);
const AGENT_STEP_RESULT_SUMMARY_BY_CODE: Readonly<
  Record<BuilderConversationAgentStepResultSummaryCode, string>
> = Object.freeze({
  agent_step_completed_without_raw_output:
    'Agent step completed. Details were not kept.',
  agent_step_needs_owner_attention:
    'Agent step needs owner attention.',
  agent_step_failed_without_raw_output:
    'Agent step could not finish. Details were not kept.',
  agent_step_cancelled_without_raw_output:
    'Agent step was stopped. Details were not kept.',
});
const AGENT_STEP_RESULT_CODE_BY_STATUS: Readonly<
  Record<BuilderConversationAgentStepResultStatus, BuilderConversationAgentStepResultSummaryCode>
> = Object.freeze({
  succeeded: 'agent_step_completed_without_raw_output',
  blocked: 'agent_step_needs_owner_attention',
  failed: 'agent_step_failed_without_raw_output',
  cancelled: 'agent_step_cancelled_without_raw_output',
});
const RUN_CONTEXT_ROUTES = Object.freeze(['answer', 'clarify', 'update_brief', 'plan', 'build']);
const RUN_CONTEXT_DISPATCHES = Object.freeze([
  'reply',
  'brief_update',
  'plan',
  'build',
  'ask_workspace',
  'ask_permission',
  'blocked',
]);
const RUN_CONTEXT_DOWNGRADE_REASONS = Object.freeze([
  'ambiguous_build_intent',
  'missing_prior_build_context',
  'workspace_required',
]);
const TOOL_RESULT_SUMMARY_BY_CODE: Readonly<Record<BuilderConversationToolResultSummaryCode, string>> = Object.freeze({
  completed_without_raw_output: 'This step completed. Details were not kept.',
  failed_without_raw_output: 'This step could not finish. Details were not kept.',
  output_rejected: 'The tool output was not accepted.',
  adapter_unavailable: 'The tool was unavailable.',
  timed_out_without_raw_output: 'This step timed out. Details were not kept.',
  cancelled_without_raw_output: 'This step was stopped. Details were not kept.',
});
const TOOL_RESULT_CODES_BY_STATUS: Readonly<Record<
  BuilderConversationToolResultStatus,
  readonly BuilderConversationToolResultSummaryCode[]
>> = Object.freeze({
  succeeded: Object.freeze([
    'completed_without_raw_output',
  ] as BuilderConversationToolResultSummaryCode[]),
  failed: Object.freeze([
    'failed_without_raw_output',
    'output_rejected',
    'adapter_unavailable',
    'timed_out_without_raw_output',
  ] as BuilderConversationToolResultSummaryCode[]),
  cancelled: Object.freeze([
    'cancelled_without_raw_output',
  ] as BuilderConversationToolResultSummaryCode[]),
});
const RUN_COMPLETED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'terminal_status',
  'result_kind',
  'failure_phase',
  'assistant_message',
  'candidate',
]);
const CANDIDATE_REVIEWED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'draft_id',
  'decision',
  'candidate_state',
  'saved_revision',
]);
const PLAN_REVIEWED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'decision',
  'plan_state',
]);
const TURN_COMPLETED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'outcome',
]);
const MESSAGE_KEYS = Object.freeze(['message_id', 'text']);
const TASK_KEYS = Object.freeze(['task_id', 'title']);
const TASK_BRIEF_KEYS = Object.freeze(['status', 'summary', 'contextual_build_ready']);
const CANDIDATE_KEYS = Object.freeze([
  'draft_id',
  'title',
  'summary',
  'candidate_state',
  'source_availability',
]);
const SAVED_REVISION_KEYS = Object.freeze(['revision_number']);
const TOOL_ACTION_RESOURCE_KINDS = {
  'context.read': ['project', 'conversation', 'task', 'run', 'revision', 'artifact'],
  'project.read': ['project', 'revision'],
  'project.edit': ['project'],
  'secret.read': ['secret'],
  'filesystem.read': ['filesystem'],
  'filesystem.write': ['filesystem'],
  'network.request': ['network'],
  'process.spawn': ['process'],
  'publication.create': ['publication'],
  'permission.grant': ['permission'],
} as const satisfies Readonly<
  Record<BuilderConversationToolAction, readonly BuilderConversationToolResourceKind[]>
>;

export class BuilderConversationSnapshotError extends Error {
  readonly code = 'builder_conversation_snapshot_unavailable';
  readonly retryable = true;
  readonly state = 'unavailable' as const;

  constructor() {
    super('Project activity is unavailable.');
    this.name = 'BuilderConversationSnapshotError';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function unavailable(): BuilderConversationSnapshotError {
  return new BuilderConversationSnapshotError();
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
  return value;
}

function exactRecordWithOptional(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): Record<string, unknown> {
  if (!isPlainObject(value)) throw unavailable();
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length < requiredKeys.length
    || ownKeys.length > allowedKeys.length
    || ownKeys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !ownKeys.includes(key))
  ) throw unavailable();
  const stringKeys = ownKeys as string[];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of stringKeys) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
    ) throw unavailable();
  }
  return value;
}

function optionalContextStatusProjection(
  source: Record<string, unknown>,
): BuilderContextStatusProjectionWire | null | undefined {
  if (!Object.hasOwn(source, 'context_status_projection')) return undefined;
  const value = source.context_status_projection;
  if (value === null) return null;
  const projection = sanitizeBuilderContextStatusProjectionWire(value);
  if (projection === null) throw unavailable();
  return projection;
}

function optionalProviderContextDisclosureStatusProjection(
  source: Record<string, unknown>,
): BuilderProviderContextDisclosureStatusProjectionWire | null | undefined {
  if (!Object.hasOwn(source, 'provider_context_disclosure_status_projection')) {
    return undefined;
  }
  const value = source.provider_context_disclosure_status_projection;
  if (value === null) return null;
  const projection = sanitizeBuilderProviderContextDisclosureStatusProjectionWire(value);
  if (projection === null) throw unavailable();
  return projection;
}

function optionalDraftCheckpointStatusProjection(
  source: Record<string, unknown>,
): BuilderDraftCheckpointStatusProjectionWire | null | undefined {
  if (!Object.hasOwn(source, 'draft_checkpoint_status_projection')) return undefined;
  const value = source.draft_checkpoint_status_projection;
  if (value === null) return null;
  const projection = sanitizeBuilderDraftCheckpointStatusProjectionWire(value);
  if (projection === null) throw unavailable();
  return projection;
}

function optionalReviewStateProjection(
  source: Record<string, unknown>,
): BuilderReviewStateProjectionWire | null | undefined {
  if (!Object.hasOwn(source, 'review_state_projection')) return undefined;
  const value = source.review_state_projection;
  if (value === null) return null;
  const projection = sanitizeBuilderReviewStateProjectionWire(value);
  if (projection === null) throw unavailable();
  return projection;
}

function optionalAgentActivityProjection(
  source: Record<string, unknown>,
): BuilderAgentActivityProjectionWire | null | undefined {
  if (!Object.hasOwn(source, 'agent_activity_projection')) return undefined;
  const value = source.agent_activity_projection;
  if (value === null) return null;
  const projection = sanitizeBuilderAgentActivityProjectionWire(value);
  if (projection === null) throw unavailable();
  return projection;
}

function optionalCheckRunOutcomeProjection(
  source: Record<string, unknown>,
): BuilderCheckRunOutcomeProjectionWire | null | undefined {
  if (!Object.hasOwn(source, 'check_run_outcome_projection')) return undefined;
  const value = source.check_run_outcome_projection;
  if (value === null) return null;
  const projection = sanitizeBuilderCheckRunOutcomeProjectionWire(value);
  if (projection === null) throw unavailable();
  return projection;
}

function denseArray(value: unknown): readonly unknown[] {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > MAX_PUBLIC_ITEMS
  ) {
    throw unavailable();
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1
    || keys.some((key) => typeof key === 'symbol')
    || !keys.includes('length')
  ) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const fresh: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
    ) throw unavailable();
    fresh.push(descriptor.value);
  }
  return fresh;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function withinCodePointLimit(value: string, maximum: number): boolean {
  let count = 0;
  for (const codePoint of value) {
    if (codePoint.length === 0) continue;
    count += 1;
    if (count > maximum) return false;
  }
  return true;
}

function hasControl(value: string, allowFormatting: boolean): boolean {
  if (UNSAFE_UNICODE_FORMAT_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code <= 0x1f && (!allowFormatting || ![9, 10, 13].includes(code))) {
      return true;
    }
  }
  return false;
}

function safeText(
  value: unknown,
  maximumCodePoints: number,
  maximumBytes: number,
  allowFormatting: boolean,
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximumCodePoints * 2
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasControl(value, allowFormatting)
    || !withinCodePointLimit(value, maximumCodePoints)
    || TEXT_ENCODER.encode(value).byteLength > maximumBytes
    || LOCAL_PATH_PATTERN.test(value.normalize('NFKC'))
    || CREDENTIAL_PATTERN.test(value.normalize('NFKC'))
  ) throw unavailable();
  return value;
}

function safePattern(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw unavailable();
  return value;
}

function safeProjectId(value: unknown): string {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value: unknown, projectId: string): string {
  const conversationId = safePattern(value, CONVERSATION_ID_PATTERN);
  if (
    conversationId.slice('builder-conversation:'.length)
    !== projectId.slice('builder-project:'.length)
  ) throw unavailable();
  return conversationId;
}

function safeSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_EVENT_SEQUENCE) {
    throw unavailable();
  }
  return Number(value);
}

function safeTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw unavailable();
  return Number(value);
}

function safeRevisionNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 1024) {
    throw unavailable();
  }
  return Number(value);
}

function safeStepIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 256) {
    throw unavailable();
  }
  return Number(value);
}

function nullableId(value: unknown, pattern: RegExp): string | null {
  return value === null ? null : safePattern(value, pattern);
}

function sanitizeMessage(value: unknown): BuilderConversationMessage {
  const source = exactRecord(value, MESSAGE_KEYS);
  return {
    message_id: safePattern(source.message_id, MESSAGE_ID_PATTERN),
    text: safeText(
      source.text,
      MAX_MESSAGE_CODE_POINTS,
      MAX_MESSAGE_UTF8_BYTES,
      true,
    ),
  };
}

function sanitizeTask(value: unknown): BuilderConversationTask | null {
  if (value === null) return null;
  const source = exactRecord(value, TASK_KEYS);
  return {
    task_id: safePattern(source.task_id, TASK_ID_PATTERN),
    title: safeText(source.title, 200, 1024, false),
  };
}

function sanitizeRequiredTask(value: unknown): BuilderConversationTask {
  const task = sanitizeTask(value);
  if (task === null) throw unavailable();
  return task;
}

function sanitizeTaskBrief(value: unknown): BuilderConversationTaskBrief {
  const source = exactRecord(value, TASK_BRIEF_KEYS);
  if (
    (source.status !== 'discussing' && source.status !== 'ready')
    || typeof source.contextual_build_ready !== 'boolean'
    || (source.status !== 'ready' && source.contextual_build_ready)
  ) throw unavailable();
  return {
    status: source.status,
    summary: safeText(source.summary, 4096, 16 * 1024, true),
    contextual_build_ready: source.contextual_build_ready,
  };
}

function sanitizeCandidate(value: unknown): BuilderConversationCandidate | null {
  if (value === null) return null;
  const source = exactRecord(value, CANDIDATE_KEYS);
  if (
    source.candidate_state !== 'proposed'
    || source.source_availability !== 'not_loaded'
  ) throw unavailable();
  return {
    draft_id: safePattern(source.draft_id, DRAFT_ID_PATTERN),
    title: safeText(source.title, 160, 1024, false),
    summary: safeText(source.summary, 2000, 8192, true),
    candidate_state: 'proposed',
    source_availability: 'not_loaded',
  };
}

function sanitizeSavedRevision(value: unknown): BuilderConversationSavedRevision {
  const source = exactRecord(value, SAVED_REVISION_KEYS);
  return {
    revision_number: safeRevisionNumber(source.revision_number),
  };
}

function sanitizeUserMessage(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'user_message' }> {
  const messageKind = source.message_kind;
  const mode = source.mode;
  const task = sanitizeTask(source.task);
  if (
    messageKind !== 'submitted'
    && messageKind !== 'steering'
    && messageKind !== 'queued_followup'
  ) throw unavailable();
  if (messageKind === 'submitted') {
    if (
      (mode !== 'question' && mode !== 'work')
      || (mode === 'work') !== (task !== null)
    ) throw unavailable();
  } else if (mode !== null || task !== null) {
    throw unavailable();
  }
  return {
    item_kind: 'user_message' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    message: sanitizeMessage(source.message),
    message_kind: messageKind,
    mode: messageKind === 'submitted' ? mode : null,
    task,
  };
}

function sanitizeQueuedFollowupConsumed(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'queued_followup_consumed' }> {
  if (source.recorded_state !== 'consumed') throw unavailable();
  const consumedBy = exactRecord(source.consumed_by, QUEUED_FOLLOWUP_CONSUMED_BY_KEYS);
  return {
    item_kind: 'queued_followup_consumed' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    message_id: safePattern(source.message_id, MESSAGE_ID_PATTERN),
    consumed_by: {
      turn_id: safePattern(consumedBy.turn_id, TURN_ID_PATTERN),
      message_id: safePattern(consumedBy.message_id, MESSAGE_ID_PATTERN),
    },
    recorded_state: 'consumed' as const,
  };
}

function sanitizeRunStarted(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'run_started' }> {
  const attemptNumber = source.attempt_number;
  if (
    !Number.isSafeInteger(attemptNumber)
    || Number(attemptNumber) < 1
    || Number(attemptNumber) > 16
    || source.recorded_state !== 'started'
  ) throw unavailable();
  const retryOfRunId = nullableId(source.retry_of_run_id, RUN_ID_PATTERN);
  if ((Number(attemptNumber) === 1) !== (retryOfRunId === null)) throw unavailable();
  return {
    item_kind: 'run_started' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    task_id: nullableId(source.task_id, TASK_ID_PATTERN),
    attempt_number: Number(attemptNumber),
    retry_of_run_id: retryOfRunId,
    recorded_state: 'started' as const,
  };
}

function sanitizeRunContextSnapshotRecorded(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'run_context_snapshot_recorded' }> {
  const context = exactRecord(source.context, RUN_CONTEXT_SNAPSHOT_CONTEXT_KEYS);
  const route = context.route;
  const dispatch = context.dispatch;
  const downgradedFrom = context.downgraded_from;
  const downgradeReason = context.downgrade_reason;
  const brief = context.brief;
  const base = context.base;
  const permissionResult = context.permission_result;
  if (
    !RUN_CONTEXT_ROUTES.includes(route as string)
    || !RUN_CONTEXT_DISPATCHES.includes(dispatch as string)
    || (downgradedFrom !== null && !RUN_CONTEXT_ROUTES.includes(downgradedFrom as string))
    || (downgradeReason !== null && !RUN_CONTEXT_DOWNGRADE_REASONS.includes(downgradeReason as string))
    || !['available', 'not_available'].includes(brief as string)
    || !['new_project_or_unsaved', 'project_revision'].includes(base as string)
    || !['not_required', 'allowed', 'ask', 'denied'].includes(permissionResult as string)
    || context.recorded_state !== 'recorded'
    || context.command_execution !== 'not_included'
    || context.network_access !== 'not_included'
  ) throw unavailable();
  return {
    item_kind: 'run_context_snapshot_recorded' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    task_id: nullableId(source.task_id, TASK_ID_PATTERN),
    context: {
      recorded_state: 'recorded',
      route: route as 'answer' | 'clarify' | 'update_brief' | 'plan' | 'build',
      dispatch: dispatch as 'reply' | 'brief_update' | 'plan' | 'build' | 'ask_workspace' | 'ask_permission' | 'blocked',
      downgraded_from: downgradedFrom as 'answer' | 'clarify' | 'update_brief' | 'plan' | 'build' | null,
      downgrade_reason: downgradeReason as 'ambiguous_build_intent' | 'missing_prior_build_context' | 'workspace_required' | null,
      brief: brief as 'available' | 'not_available',
      base: base as 'new_project_or_unsaved' | 'project_revision',
      permission_result: permissionResult as 'not_required' | 'allowed' | 'ask' | 'denied',
      command_execution: 'not_included',
      network_access: 'not_included',
    },
  };
}

function sanitizeProgrammingRunAdmitted(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'programming_run_admitted' }> {
  if (source.recorded_state !== 'admitted') throw unavailable();
  return {
    item_kind: 'programming_run_admitted',
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    task_id: safePattern(source.task_id, TASK_ID_PATTERN),
    recorded_state: 'admitted',
  };
}

function sanitizeRunControl(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'run_control_requested' }> {
  if (source.action !== 'cancel' && source.action !== 'interrupt') throw unavailable();
  return {
    item_kind: 'run_control_requested' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    action: source.action,
  };
}

function sanitizeRunProgress(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'run_progress_recorded' }> {
  if (
    source.recorded_state !== 'recorded'
    || typeof source.stage !== 'string'
    || !RUN_PROGRESS_STAGES.includes(source.stage as BuilderConversationRunProgressStage)
  ) throw unavailable();
  return {
    item_kind: 'run_progress_recorded' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    stage: source.stage as BuilderConversationRunProgressStage,
    recorded_state: 'recorded' as const,
  };
}

function sanitizeAgentStepResultStatus(
  value: unknown,
): BuilderConversationAgentStepResultStatus {
  if (
    value !== 'succeeded'
    && value !== 'blocked'
    && value !== 'failed'
    && value !== 'cancelled'
  ) throw unavailable();
  return value;
}

function sanitizeAgentStepResultSummaryCode(
  value: unknown,
  status: BuilderConversationAgentStepResultStatus,
): BuilderConversationAgentStepResultSummaryCode {
  if (
    typeof value !== 'string'
    || AGENT_STEP_RESULT_CODE_BY_STATUS[status] !== value
  ) throw unavailable();
  return value as BuilderConversationAgentStepResultSummaryCode;
}

function sanitizeAgentStepResult(
  value: unknown,
): BuilderConversationAgentStepResult {
  const source = exactRecord(value, AGENT_STEP_RESULT_KEYS);
  const status = sanitizeAgentStepResultStatus(source.status);
  const summaryCode = sanitizeAgentStepResultSummaryCode(source.summary_code, status);
  const displaySummary = AGENT_STEP_RESULT_SUMMARY_BY_CODE[summaryCode];
  if (source.display_summary !== displaySummary) throw unavailable();
  return {
    status,
    summary_code: summaryCode,
    display_summary: displaySummary,
  };
}

function sanitizeAgentStepSummary(
  value: unknown,
  result: BuilderConversationAgentStepResult | null,
): BuilderConversationAgentStepSummary {
  const source = exactRecord(value, AGENT_STEP_SUMMARY_KEYS);
  if (result === null) {
    if (
      source.status !== 'started'
      || source.display_summary !== 'Agent step start was recorded.'
    ) throw unavailable();
    return {
      status: 'started',
      display_summary: 'Agent step start was recorded.',
    };
  }
  if (
    source.status !== result.status
    || source.display_summary !== result.display_summary
  ) throw unavailable();
  return {
    status: result.status,
    display_summary: result.display_summary,
  };
}

function sanitizeAgentStepLifecycle(value: unknown): BuilderConversationAgentStepLifecycle {
  const source = exactRecord(value, AGENT_STEP_LIFECYCLE_KEYS);
  if (
    source.conversation_admission !== 'verified_public_progress'
    || source.raw_output_admission !== 'not_included'
    || source.revision_admission !== 'not_created'
  ) throw unavailable();
  return {
    conversation_admission: 'verified_public_progress',
    raw_output_admission: 'not_included',
    revision_admission: 'not_created',
  };
}

function sanitizeAgentStepProgress(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'agent_step_progress_recorded' }> {
  const recordedState = source.recorded_state;
  if (
    recordedState !== 'start_recorded'
    && recordedState !== 'result_recorded'
  ) throw unavailable();
  const result = source.result === null ? null : sanitizeAgentStepResult(source.result);
  if ((recordedState === 'start_recorded') !== (result === null)) {
    throw unavailable();
  }
  return {
    item_kind: 'agent_step_progress_recorded' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    task_id: safePattern(source.task_id, TASK_ID_PATTERN),
    step_id: safePattern(source.step_id, STEP_ID_PATTERN),
    step_index: safeStepIndex(source.step_index),
    recorded_state: recordedState,
    result,
    summary: sanitizeAgentStepSummary(source.summary, result),
    lifecycle: sanitizeAgentStepLifecycle(source.lifecycle),
  };
}

function sanitizeTaskBriefUpdated(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'task_brief_updated' }> {
  if (source.recorded_state !== 'updated') throw unavailable();
  return {
    item_kind: 'task_brief_updated' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    task: sanitizeRequiredTask(source.task),
    brief: sanitizeTaskBrief(source.brief),
    recorded_state: 'updated' as const,
  };
}

function sanitizeToolAction(value: unknown): BuilderConversationToolAction {
  if (
    typeof value !== 'string'
    || !Object.hasOwn(TOOL_ACTION_RESOURCE_KINDS, value)
  ) throw unavailable();
  return value as BuilderConversationToolAction;
}

function sanitizeToolResource(
  value: unknown,
  action: BuilderConversationToolAction,
): Readonly<{ resource_kind: BuilderConversationToolResourceKind }> {
  const source = exactRecord(value, TOOL_RESOURCE_KEYS);
  const resourceKind = source.resource_kind;
  const allowedKinds = TOOL_ACTION_RESOURCE_KINDS[action] as readonly BuilderConversationToolResourceKind[];
  if (
    typeof resourceKind !== 'string'
    || !allowedKinds.includes(resourceKind as BuilderConversationToolResourceKind)
  ) throw unavailable();
  return {
    resource_kind: resourceKind as BuilderConversationToolResourceKind,
  };
}

function sanitizeToolLifecycle(value: unknown): BuilderConversationToolCallLifecycle {
  const source = exactRecord(value, TOOL_LIFECYCLE_KEYS);
  if (
    source.permission_admission !== 'verified_allowed'
    || source.dispatch_admission !== 'not_started'
    || source.execution_admission !== 'not_performed'
    || source.result_admission !== 'not_recorded'
  ) throw unavailable();
  return {
    permission_admission: 'verified_allowed',
    dispatch_admission: 'not_started',
    execution_admission: 'not_performed',
    result_admission: 'not_recorded',
  };
}

function sanitizeToolResultStatus(value: unknown): BuilderConversationToolResultStatus {
  if (
    value !== 'succeeded'
    && value !== 'failed'
    && value !== 'cancelled'
  ) throw unavailable();
  return value;
}

function sanitizeToolResultSummaryCode(
  value: unknown,
  status: BuilderConversationToolResultStatus,
): BuilderConversationToolResultSummaryCode {
  if (
    typeof value !== 'string'
    || !TOOL_RESULT_CODES_BY_STATUS[status].includes(
      value as BuilderConversationToolResultSummaryCode,
    )
  ) throw unavailable();
  return value as BuilderConversationToolResultSummaryCode;
}

function sanitizeToolResult(value: unknown): BuilderConversationToolResult {
  const source = exactRecord(value, TOOL_RESULT_KEYS);
  const status = sanitizeToolResultStatus(source.status);
  const summaryCode = sanitizeToolResultSummaryCode(source.summary_code, status);
  const displaySummary = TOOL_RESULT_SUMMARY_BY_CODE[summaryCode];
  if (source.display_summary !== displaySummary) throw unavailable();
  return {
    status,
    summary_code: summaryCode,
    display_summary: displaySummary,
  };
}

function sanitizeToolResultLifecycle(value: unknown): BuilderConversationToolResultLifecycle {
  const source = exactRecord(value, TOOL_RESULT_LIFECYCLE_KEYS);
  if (
    source.result_admission !== 'fixed_summary_code_recorded'
    || source.raw_output_admission !== 'not_included'
    || source.revision_admission !== 'not_created'
  ) throw unavailable();
  return {
    result_admission: 'fixed_summary_code_recorded',
    raw_output_admission: 'not_included',
    revision_admission: 'not_created',
  };
}

function sanitizeToolCallRequested(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'tool_call_requested' }> {
  const action = sanitizeToolAction(source.action);
  const toolLabel = TOOL_LABEL_BY_ACTION[action];
  if (source.recorded_state !== 'requested') throw unavailable();
  if (source.tool_label !== toolLabel) throw unavailable();
  return {
    item_kind: 'tool_call_requested' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    step_id: safePattern(source.step_id, STEP_ID_PATTERN),
    tool_call_id: safePattern(source.tool_call_id, TOOL_CALL_ID_PATTERN),
    tool_label: toolLabel,
    action,
    resource: sanitizeToolResource(source.resource, action),
    lifecycle: sanitizeToolLifecycle(source.lifecycle),
    recorded_state: 'requested',
  };
}

function sanitizeToolCallResultRecorded(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'tool_call_result_recorded' }> {
  const action = sanitizeToolAction(source.action);
  const toolLabel = TOOL_LABEL_BY_ACTION[action];
  if (source.recorded_state !== 'recorded') throw unavailable();
  if (source.tool_label !== toolLabel) throw unavailable();
  return {
    item_kind: 'tool_call_result_recorded' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    step_id: safePattern(source.step_id, STEP_ID_PATTERN),
    tool_call_id: safePattern(source.tool_call_id, TOOL_CALL_ID_PATTERN),
    tool_label: toolLabel,
    action,
    resource: sanitizeToolResource(source.resource, action),
    result: sanitizeToolResult(source.result),
    lifecycle: sanitizeToolResultLifecycle(source.lifecycle),
    recorded_state: 'recorded' as const,
  };
}

function sanitizeRunCompleted(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'run_completed' }> {
  const terminalStatus = source.terminal_status;
  const resultKind = source.result_kind;
  const failurePhase = source.failure_phase;
  if (
    !['succeeded', 'failed', 'interrupted', 'cancelled'].includes(
      terminalStatus as string,
    )
    || !['explanation', 'plan', 'candidate', 'failure'].includes(
      resultKind as string,
    )
    || (terminalStatus === 'succeeded') !== (resultKind !== 'failure')
    || ![
      'not_applicable',
      'not_recorded',
      'context_ready',
      'provider_request_started',
      'provider_response_received',
      'result_preparing',
    ].includes(failurePhase as string)
    || (terminalStatus === 'failed')
      !== (failurePhase !== 'not_applicable')
  ) throw unavailable();
  const assistantMessage = source.assistant_message === null
    ? null
    : sanitizeMessage(source.assistant_message);
  if (
    assistantMessage === null
    && terminalStatus !== 'interrupted'
    && terminalStatus !== 'cancelled'
  ) throw unavailable();
  const candidate = sanitizeCandidate(source.candidate);
  if ((resultKind === 'candidate') !== (candidate !== null)) throw unavailable();
  return {
    item_kind: 'run_completed' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    terminal_status: terminalStatus as
      | 'succeeded'
      | 'failed'
      | 'interrupted'
      | 'cancelled',
    result_kind: resultKind as 'explanation' | 'plan' | 'candidate' | 'failure',
    failure_phase: failurePhase as BuilderConversationFailurePhase,
    assistant_message: assistantMessage,
    candidate,
  };
}

function sanitizeCandidateReviewed(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'candidate_reviewed' }> {
  const decision = source.decision;
  if (decision !== 'accepted' && decision !== 'rejected') throw unavailable();
  if (decision === 'accepted') {
    if (source.candidate_state !== 'saved') throw unavailable();
    return {
      item_kind: 'candidate_reviewed' as const,
      sequence,
      turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
      run_id: safePattern(source.run_id, RUN_ID_PATTERN),
      draft_id: safePattern(source.draft_id, DRAFT_ID_PATTERN),
      decision: 'accepted',
      candidate_state: 'saved',
      saved_revision: sanitizeSavedRevision(source.saved_revision),
    };
  }
  if (
    source.candidate_state !== 'rejected'
    || source.saved_revision !== null
  ) throw unavailable();
  return {
    item_kind: 'candidate_reviewed' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    draft_id: safePattern(source.draft_id, DRAFT_ID_PATTERN),
    decision: 'rejected',
    candidate_state: 'rejected',
    saved_revision: null,
  };
}

function sanitizePlanReviewed(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'plan_reviewed' }> {
  const decision = source.decision;
  if (decision !== 'approved' && decision !== 'rejected') throw unavailable();
  if (source.plan_state !== decision) throw unavailable();
  return {
    item_kind: 'plan_reviewed' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: safePattern(source.run_id, RUN_ID_PATTERN),
    decision,
    plan_state: decision,
  };
}

function sanitizeTurnCompleted(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'turn_completed' }> {
  const outcome = source.outcome;
  if (![
    'answered',
    'responded',
    'plan_proposed',
    'candidate_ready',
    'failed',
    'interrupted',
    'cancelled',
  ].includes(outcome as string)) throw unavailable();
  return {
    item_kind: 'turn_completed' as const,
    sequence,
    turn_id: safePattern(source.turn_id, TURN_ID_PATTERN),
    run_id: nullableId(source.run_id, RUN_ID_PATTERN),
    outcome: outcome as
      | 'answered'
      | 'responded'
      | 'plan_proposed'
      | 'candidate_ready'
      | 'failed'
      | 'interrupted'
      | 'cancelled',
  };
}

function sanitizeItem(value: unknown): BuilderConversationItem {
  if (!isPlainObject(value)) throw unavailable();
  const itemKindDescriptor = Object.getOwnPropertyDescriptor(value, 'item_kind');
  if (
    !itemKindDescriptor
    || !itemKindDescriptor.enumerable
    || !Object.hasOwn(itemKindDescriptor, 'value')
  ) throw unavailable();
  const itemKind = itemKindDescriptor.value;
  let source: Record<string, unknown>;
  if (itemKind === 'user_message') {
    source = exactRecord(value, USER_MESSAGE_KEYS);
  } else if (itemKind === 'queued_followup_consumed') {
    source = exactRecord(value, QUEUED_FOLLOWUP_CONSUMED_KEYS);
  } else if (itemKind === 'run_started') {
    source = exactRecord(value, RUN_STARTED_KEYS);
  } else if (itemKind === 'run_context_snapshot_recorded') {
    source = exactRecord(value, RUN_CONTEXT_SNAPSHOT_RECORDED_KEYS);
  } else if (itemKind === 'programming_run_admitted') {
    source = exactRecord(value, PROGRAMMING_RUN_ADMITTED_KEYS);
  } else if (itemKind === 'run_control_requested') {
    source = exactRecord(value, RUN_CONTROL_KEYS);
  } else if (itemKind === 'run_progress_recorded') {
    source = exactRecord(value, RUN_PROGRESS_KEYS);
  } else if (itemKind === 'agent_step_progress_recorded') {
    source = exactRecord(value, AGENT_STEP_PROGRESS_RECORDED_KEYS);
  } else if (itemKind === 'task_brief_updated') {
    source = exactRecord(value, TASK_BRIEF_UPDATED_KEYS);
  } else if (itemKind === 'tool_call_result_recorded') {
    source = exactRecord(value, TOOL_CALL_RESULT_RECORDED_KEYS);
  } else if (itemKind === 'tool_call_requested') {
    source = exactRecord(value, TOOL_CALL_REQUESTED_KEYS);
  } else if (itemKind === 'run_completed') {
    source = exactRecord(value, RUN_COMPLETED_KEYS);
  } else if (itemKind === 'candidate_reviewed') {
    source = exactRecord(value, CANDIDATE_REVIEWED_KEYS);
  } else if (itemKind === 'plan_reviewed') {
    source = exactRecord(value, PLAN_REVIEWED_KEYS);
  } else if (itemKind === 'turn_completed') {
    source = exactRecord(value, TURN_COMPLETED_KEYS);
  } else {
    throw unavailable();
  }
  const sequence = safeSequence(source.sequence);
  if (itemKind === 'user_message') return sanitizeUserMessage(source, sequence);
  if (itemKind === 'queued_followup_consumed') {
    return sanitizeQueuedFollowupConsumed(source, sequence);
  }
  if (itemKind === 'run_started') return sanitizeRunStarted(source, sequence);
  if (itemKind === 'run_context_snapshot_recorded') {
    return sanitizeRunContextSnapshotRecorded(source, sequence);
  }
  if (itemKind === 'programming_run_admitted') {
    return sanitizeProgrammingRunAdmitted(source, sequence);
  }
  if (itemKind === 'run_control_requested') return sanitizeRunControl(source, sequence);
  if (itemKind === 'run_progress_recorded') return sanitizeRunProgress(source, sequence);
  if (itemKind === 'agent_step_progress_recorded') return sanitizeAgentStepProgress(source, sequence);
  if (itemKind === 'task_brief_updated') return sanitizeTaskBriefUpdated(source, sequence);
  if (itemKind === 'tool_call_result_recorded') {
    return sanitizeToolCallResultRecorded(source, sequence);
  }
  if (itemKind === 'tool_call_requested') return sanitizeToolCallRequested(source, sequence);
  if (itemKind === 'run_completed') return sanitizeRunCompleted(source, sequence);
  if (itemKind === 'candidate_reviewed') return sanitizeCandidateReviewed(source, sequence);
  if (itemKind === 'plan_reviewed') return sanitizePlanReviewed(source, sequence);
  return sanitizeTurnCompleted(source, sequence);
}

type ReplayTurn = {
  turn_id: string;
  mode: 'question' | 'work';
  task: BuilderConversationTask | null;
  submitted_message_id: string;
  submitted_text: string;
  runs: Array<{
    run_id: string;
    attempt_number: number;
    status: 'running' | 'completed';
    terminal_status: 'succeeded' | 'failed' | 'interrupted' | 'cancelled' | null;
    result_kind: 'explanation' | 'plan' | 'candidate' | 'failure' | null;
    candidate_draft_id: string | null;
    plan_review: 'approved' | 'rejected' | null;
    candidate_review: 'accepted' | 'rejected' | null;
    pending_tool_calls: number;
    control: 'cancel' | 'interrupt' | null;
    context_snapshot_recorded: boolean;
    programming_run_admitted: boolean;
    progress_stages: BuilderConversationRunProgressStage[];
    agent_step_progress: Map<
      string,
      { step_index: number; result_recorded: boolean }
    >;
  }>;
};

function expectedOutcome(run: ReplayTurn['runs'][number]) {
  if (run.terminal_status === 'succeeded') {
    if (run.result_kind === 'candidate') return 'candidate_ready';
    if (run.result_kind === 'plan') return 'plan_proposed';
    return 'responded';
  }
  return run.terminal_status;
}

function resultMatchesMode(
  mode: 'question' | 'work' | 'unknown',
  run: Pick<ReplayTurn['runs'][number], 'terminal_status' | 'result_kind'>,
): boolean {
  return !(
    run.terminal_status === 'succeeded'
    && mode === 'question'
    && run.result_kind !== 'explanation'
  );
}

function failurePhaseMatchesRun(
  run: Readonly<{
    attempt_number: number | null;
    progress_stages: readonly BuilderConversationRunProgressStage[];
  }>,
  item: Extract<BuilderConversationItem, { item_kind: 'run_completed' }>,
  mayUsePrefixState: boolean,
): boolean {
  if (item.terminal_status !== 'failed') return item.failure_phase === 'not_applicable';
  const latestStage = run.progress_stages.at(-1) ?? null;
  if (latestStage !== null) return item.failure_phase === latestStage;
  if (mayUsePrefixState && run.attempt_number === null) {
    return item.failure_phase !== 'not_applicable';
  }
  return item.failure_phase === 'not_recorded';
}

function recordAgentStepProgress(
  run: {
    run_id: string;
    status: 'running' | 'completed';
    control: 'cancel' | 'interrupt' | 'unknown' | null;
    agent_step_progress: Map<string, { step_index: number; result_recorded: boolean }>;
  },
  item: Extract<BuilderConversationItem, { item_kind: 'agent_step_progress_recorded' }>,
  mayDependOnOmittedStart: boolean,
): void {
  if (
    run.run_id !== item.run_id
    || run.status !== 'running'
    || run.control !== null
  ) throw unavailable();
  const existing = run.agent_step_progress.get(item.step_id) ?? null;
  if (item.recorded_state === 'start_recorded') {
    if (existing !== null || item.result !== null) throw unavailable();
    run.agent_step_progress.set(item.step_id, {
      step_index: item.step_index,
      result_recorded: false,
    });
    return;
  }
  if (item.result === null) throw unavailable();
  if (existing === null) {
    if (!mayDependOnOmittedStart) throw unavailable();
    run.agent_step_progress.set(item.step_id, {
      step_index: item.step_index,
      result_recorded: true,
    });
    return;
  }
  if (existing.step_index !== item.step_index || existing.result_recorded) {
    throw unavailable();
  }
  run.agent_step_progress.set(item.step_id, {
    step_index: item.step_index,
    result_recorded: true,
  });
}

function validateCompleteWindow(
  items: readonly BuilderConversationItem[],
  recordedActiveTurnId: string | null,
): void {
  const turns = new Map<string, ReplayTurn>();
  const messageIds = new Set<string>();
  const taskIds = new Set<string>();
  const runIds = new Set<string>();
  const draftIds = new Set<string>();
  const stepIds = new Set<string>();
  const toolCallIds = new Set<string>();
  const toolCallRequests = new Map<
    string,
    {
      run_id: string;
      step_id: string;
      action: BuilderConversationToolAction;
      resource_kind: BuilderConversationToolResourceKind;
      result_recorded: boolean;
    }
  >();
  const queuedFollowups = new Map<string, {
    consumed: boolean;
    run_id: string;
    text: string;
    turn_id: string;
  }>();
  let activeTurn: ReplayTurn | null = null;

  for (const item of items) {
    if (item.item_kind === 'user_message') {
      if (messageIds.has(item.message.message_id)) throw unavailable();
      messageIds.add(item.message.message_id);
      if (item.message_kind === 'submitted') {
        if (activeTurn !== null || turns.has(item.turn_id)) throw unavailable();
        if (item.task !== null) {
          if (taskIds.has(item.task.task_id)) throw unavailable();
          taskIds.add(item.task.task_id);
        }
        activeTurn = {
          turn_id: item.turn_id,
          mode: item.mode as 'question' | 'work',
          task: item.task,
          submitted_message_id: item.message.message_id,
          submitted_text: item.message.text,
          runs: [],
        };
        turns.set(item.turn_id, activeTurn);
      } else if (activeTurn?.turn_id !== item.turn_id) {
        throw unavailable();
      } else {
        const currentRun = activeTurn.runs.at(-1) ?? null;
        if (
          currentRun !== null
          && (currentRun.status !== 'running' || currentRun.control !== null)
        ) throw unavailable();
        if (item.message_kind === 'queued_followup') {
          if (currentRun === null || queuedFollowups.has(item.message.message_id)) {
            throw unavailable();
          }
          queuedFollowups.set(item.message.message_id, {
            consumed: false,
            run_id: currentRun.run_id,
            text: item.message.text,
            turn_id: item.turn_id,
          });
        }
      }
      continue;
    }

    if (item.item_kind === 'queued_followup_consumed') {
      if (activeTurn === null) throw unavailable();
      const queued = queuedFollowups.get(item.message_id) ?? null;
      if (
        queued === null
        || queued.consumed
        || queued.turn_id !== item.turn_id
        || queued.run_id !== item.run_id
        || item.consumed_by.turn_id !== activeTurn.turn_id
        || item.consumed_by.message_id !== activeTurn.submitted_message_id
        || activeTurn.submitted_text !== queued.text
        || activeTurn.runs.length !== 0
      ) throw unavailable();
      queued.consumed = true;
      continue;
    }

    if (item.item_kind === 'candidate_reviewed') {
      if (activeTurn !== null) throw unavailable();
      const reviewedTurn = turns.get(item.turn_id);
      const reviewedRun = reviewedTurn?.runs.find((run) => run.run_id === item.run_id) ?? null;
      if (
        reviewedTurn === undefined
        || reviewedRun === null
        || reviewedRun.status !== 'completed'
        || reviewedRun.terminal_status !== 'succeeded'
        || reviewedRun.result_kind !== 'candidate'
        || reviewedRun.candidate_draft_id !== item.draft_id
        || reviewedRun.candidate_review !== null
      ) throw unavailable();
      reviewedRun.candidate_review = item.decision;
      continue;
    }

    if (item.item_kind === 'plan_reviewed') {
      if (activeTurn !== null) throw unavailable();
      const reviewedTurn = turns.get(item.turn_id);
      const reviewedRun = reviewedTurn?.runs.find((run) => run.run_id === item.run_id) ?? null;
      if (
        reviewedTurn === undefined
        || reviewedRun === null
        || reviewedRun.status !== 'completed'
        || reviewedRun.terminal_status !== 'succeeded'
        || reviewedRun.result_kind !== 'plan'
        || reviewedRun.plan_review !== null
      ) throw unavailable();
      reviewedRun.plan_review = item.decision;
      continue;
    }

    if (activeTurn === null || activeTurn.turn_id !== item.turn_id) throw unavailable();
    const currentRun = activeTurn.runs.at(-1) ?? null;
    if (item.item_kind === 'run_started') {
      if (runIds.has(item.run_id)) throw unavailable();
      if (
        (activeTurn.mode === 'work'
          && item.task_id !== activeTurn.task?.task_id)
        || (activeTurn.mode === 'question' && item.task_id !== null)
      ) throw unavailable();
      if (currentRun === null) {
        if (item.attempt_number !== 1 || item.retry_of_run_id !== null) throw unavailable();
      } else if (
        currentRun.status !== 'completed'
        || !['failed', 'interrupted', 'cancelled'].includes(
          currentRun.terminal_status as string,
        )
        || item.attempt_number !== currentRun.attempt_number + 1
        || item.retry_of_run_id !== currentRun.run_id
      ) {
        throw unavailable();
      }
      runIds.add(item.run_id);
      activeTurn.runs.push({
        run_id: item.run_id,
        attempt_number: item.attempt_number,
        status: 'running',
        terminal_status: null,
        result_kind: null,
        candidate_draft_id: null,
        plan_review: null,
        candidate_review: null,
        pending_tool_calls: 0,
        control: null,
        context_snapshot_recorded: false,
        programming_run_admitted: false,
        progress_stages: [],
        agent_step_progress: new Map(),
      });
      continue;
    }
    if (currentRun === null || currentRun.run_id !== item.run_id) throw unavailable();
    if (item.item_kind === 'run_context_snapshot_recorded') {
      if (
        currentRun.status !== 'running'
        || currentRun.control !== null
        || currentRun.context_snapshot_recorded
        || currentRun.progress_stages.length > 0
        || currentRun.pending_tool_calls > 0
      ) throw unavailable();
      currentRun.context_snapshot_recorded = true;
      continue;
    }
    if (item.item_kind === 'programming_run_admitted') {
      if (
        activeTurn.mode !== 'work'
        || activeTurn.task?.task_id !== item.task_id
        || currentRun.status !== 'running'
        || currentRun.control !== null
        || !currentRun.context_snapshot_recorded
        || currentRun.programming_run_admitted
        || currentRun.progress_stages.length > 0
        || currentRun.pending_tool_calls > 0
      ) throw unavailable();
      currentRun.programming_run_admitted = true;
      continue;
    }
    if (item.item_kind === 'task_brief_updated') {
      if (
        activeTurn.mode !== 'question'
        || activeTurn.task !== null
        || currentRun.status !== 'completed'
        || currentRun.terminal_status !== 'succeeded'
        || currentRun.result_kind !== 'explanation'
        || taskIds.has(item.task.task_id)
        || item.brief.status !== 'ready'
        || !item.brief.contextual_build_ready
      ) throw unavailable();
      taskIds.add(item.task.task_id);
      continue;
    }
    if (item.item_kind === 'run_progress_recorded') {
      const previousStage = currentRun.progress_stages.at(-1) ?? null;
      const previousIndex = previousStage === null ? -1 : RUN_PROGRESS_STAGES.indexOf(previousStage);
      const stageIndex = RUN_PROGRESS_STAGES.indexOf(item.stage);
      const expectedIndex = previousStage === null ? 0 : previousIndex + 1;
      if (
        currentRun.status !== 'running'
        || currentRun.control !== null
        || stageIndex !== expectedIndex
      ) throw unavailable();
      currentRun.progress_stages.push(item.stage);
      continue;
    }
    if (item.item_kind === 'agent_step_progress_recorded') {
      if (
        activeTurn.mode !== 'work'
        || activeTurn.task === null
        || item.task_id !== activeTurn.task.task_id
      ) throw unavailable();
      recordAgentStepProgress(currentRun, item, false);
      continue;
    }
    if (item.item_kind === 'tool_call_requested') {
      if (
        activeTurn.mode !== 'work'
        || activeTurn.task === null
        || currentRun.status !== 'running'
        || currentRun.control !== null
        || stepIds.has(item.step_id)
        || toolCallIds.has(item.tool_call_id)
      ) throw unavailable();
      stepIds.add(item.step_id);
      toolCallIds.add(item.tool_call_id);
      toolCallRequests.set(item.tool_call_id, {
        run_id: item.run_id,
        step_id: item.step_id,
        action: item.action,
        resource_kind: item.resource.resource_kind,
        result_recorded: false,
      });
      currentRun.pending_tool_calls += 1;
      continue;
    }
    if (item.item_kind === 'tool_call_result_recorded') {
      const requested = toolCallRequests.get(item.tool_call_id) ?? null;
      if (
        activeTurn.mode !== 'work'
        || activeTurn.task === null
        || currentRun.status !== 'running'
        || currentRun.control !== null
        || requested === null
        || requested.run_id !== item.run_id
        || requested.step_id !== item.step_id
        || requested.action !== item.action
        || requested.resource_kind !== item.resource.resource_kind
        || requested.result_recorded
      ) throw unavailable();
      toolCallRequests.set(item.tool_call_id, {
        ...requested,
        result_recorded: true,
      });
      currentRun.pending_tool_calls -= 1;
      if (currentRun.pending_tool_calls < 0) throw unavailable();
      continue;
    }
    if (item.item_kind === 'run_control_requested') {
      if (currentRun.status !== 'running' || currentRun.control !== null) throw unavailable();
      currentRun.control = item.action;
      continue;
    }
    if (item.item_kind === 'run_completed') {
      if (
        currentRun.status !== 'running'
        || !resultMatchesMode(activeTurn.mode, item)
        || !failurePhaseMatchesRun(currentRun, item, false)
      ) throw unavailable();
      if (
        (currentRun.control === 'cancel' && item.terminal_status !== 'cancelled')
        || (currentRun.control === 'interrupt' && item.terminal_status !== 'interrupted')
        || (currentRun.control === null
          && (item.terminal_status === 'cancelled' || item.terminal_status === 'interrupted'))
        || (currentRun.pending_tool_calls > 0 && item.terminal_status === 'succeeded')
      ) throw unavailable();
      if (item.assistant_message !== null) {
        if (messageIds.has(item.assistant_message.message_id)) throw unavailable();
        messageIds.add(item.assistant_message.message_id);
      }
      if (item.candidate !== null) {
        if (draftIds.has(item.candidate.draft_id)) throw unavailable();
        draftIds.add(item.candidate.draft_id);
      }
      currentRun.status = 'completed';
      currentRun.terminal_status = item.terminal_status;
      currentRun.result_kind = item.result_kind;
      currentRun.candidate_draft_id = item.candidate?.draft_id ?? null;
      continue;
    }
    if (
      currentRun.status !== 'completed'
      || item.outcome !== (
        activeTurn.mode === 'question' && currentRun.terminal_status === 'succeeded'
          ? 'answered'
          : expectedOutcome(currentRun)
      )
    ) throw unavailable();
    activeTurn = null;
  }
  if ((activeTurn?.turn_id ?? null) !== recordedActiveTurnId) throw unavailable();
}

type SuffixRun = {
  run_id: string;
  attempt_number: number | null;
  status: 'running' | 'completed';
  terminal_status: 'succeeded' | 'failed' | 'interrupted' | 'cancelled' | null;
  result_kind: 'explanation' | 'plan' | 'candidate' | 'failure' | null;
  candidate_draft_id: string | null;
  plan_review: 'approved' | 'rejected' | null;
  candidate_review: 'accepted' | 'rejected' | null;
  pending_tool_calls: number;
  control: 'cancel' | 'interrupt' | 'unknown' | null;
  context_snapshot_recorded: boolean;
  programming_run_admitted: boolean;
  progress_stages: BuilderConversationRunProgressStage[];
  agent_step_progress: Map<
    string,
    { step_index: number; result_recorded: boolean }
  >;
};

type SuffixTurn = {
  turn_id: string;
  mode: 'question' | 'work' | 'unknown';
  task_id: string | null;
  origin: 'visible' | 'prefix';
  submitted_message_id: string | null;
  submitted_text: string | null;
  current_run: SuffixRun | null;
};

function expectedSuffixOutcome(
  turn: SuffixTurn,
  run: SuffixRun,
  outcome: Extract<
    BuilderConversationItem,
    { item_kind: 'turn_completed' }
  >['outcome'],
): boolean {
  if (run.terminal_status !== 'succeeded') {
    return outcome === run.terminal_status;
  }
  if (run.result_kind === 'candidate') return outcome === 'candidate_ready';
  if (run.result_kind === 'plan') return outcome === 'plan_proposed';
  if (turn.mode === 'question') return outcome === 'answered';
  if (turn.mode === 'work') return outcome === 'responded';
  return outcome === 'answered' || outcome === 'responded';
}

function validateTruncatedWindow(
  items: readonly BuilderConversationItem[],
  recordedActiveTurnId: string | null,
): void {
  const turnIds = new Set<string>();
  const messageIds = new Set<string>();
  const taskIds = new Set<string>();
  const runIds = new Set<string>();
  const draftIds = new Set<string>();
  const stepIds = new Set<string>();
  const toolCallIds = new Set<string>();
  const toolCallRequests = new Map<
    string,
    {
      run_id: string;
      step_id: string;
      action: BuilderConversationToolAction;
      resource_kind: BuilderConversationToolResourceKind;
      result_recorded: boolean;
    }
  >();
  const completedCandidateRuns = new Map<
    string,
    Readonly<{ turn_id: string; draft_id: string; review: 'accepted' | 'rejected' | null }>
  >();
  const completedPlanRuns = new Map<
    string,
    Readonly<{ turn_id: string; review: 'approved' | 'rejected' | null }>
  >();
  const queuedFollowups = new Map<string, {
    consumed: boolean;
    run_id: string;
    text: string;
    turn_id: string;
  }>();
  let activeTurn: SuffixTurn | null = null;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const mayUsePrefixState = index === 0;

    if (item.item_kind === 'user_message') {
      if (messageIds.has(item.message.message_id)) throw unavailable();
      messageIds.add(item.message.message_id);
      if (item.message_kind === 'submitted') {
        if (activeTurn !== null || turnIds.has(item.turn_id)) throw unavailable();
        turnIds.add(item.turn_id);
        if (item.task !== null) {
          if (taskIds.has(item.task.task_id)) throw unavailable();
          taskIds.add(item.task.task_id);
        }
        activeTurn = {
          turn_id: item.turn_id,
          mode: item.mode as 'question' | 'work',
          task_id: item.task?.task_id ?? null,
          origin: 'visible',
          submitted_message_id: item.message.message_id,
          submitted_text: item.message.text,
          current_run: null,
        };
      } else {
        if (activeTurn === null) {
          if (!mayUsePrefixState) throw unavailable();
          if (turnIds.has(item.turn_id)) throw unavailable();
          turnIds.add(item.turn_id);
          activeTurn = {
            turn_id: item.turn_id,
            mode: 'unknown',
            task_id: null,
            origin: 'prefix',
            submitted_message_id: null,
            submitted_text: null,
            current_run: null,
          };
        }
        if (activeTurn.turn_id !== item.turn_id) throw unavailable();
        if (
          activeTurn.current_run !== null
          && (
            activeTurn.current_run.status !== 'running'
            || activeTurn.current_run.control !== null
          )
        ) throw unavailable();
        if (item.message_kind === 'queued_followup') {
          if (
            activeTurn.current_run === null
            || queuedFollowups.has(item.message.message_id)
          ) throw unavailable();
          queuedFollowups.set(item.message.message_id, {
            consumed: false,
            run_id: activeTurn.current_run.run_id,
            text: item.message.text,
            turn_id: item.turn_id,
          });
        }
      }
      continue;
    }

    if (item.item_kind === 'queued_followup_consumed') {
      const queued = queuedFollowups.get(item.message_id) ?? null;
      if (
        queued !== null
        && (
          queued.consumed
          || queued.turn_id !== item.turn_id
          || queued.run_id !== item.run_id
        )
      ) throw unavailable();
      if (activeTurn === null) {
        if (!mayUsePrefixState || turnIds.has(item.consumed_by.turn_id)) {
          throw unavailable();
        }
        turnIds.add(item.consumed_by.turn_id);
        activeTurn = {
          turn_id: item.consumed_by.turn_id,
          mode: 'unknown',
          task_id: null,
          origin: 'prefix',
          submitted_message_id: item.consumed_by.message_id,
          submitted_text: null,
          current_run: null,
        };
      }
      if (
        activeTurn.turn_id !== item.consumed_by.turn_id
        || activeTurn.current_run !== null
        || (
          activeTurn.submitted_message_id !== null
          && activeTurn.submitted_message_id !== item.consumed_by.message_id
        )
        || (
          queued !== null
          && activeTurn.submitted_text !== null
          && activeTurn.submitted_text !== queued.text
        )
      ) throw unavailable();
      if (queued !== null) queued.consumed = true;
      continue;
    }

    if (item.item_kind === 'candidate_reviewed') {
      if (activeTurn !== null) throw unavailable();
      const completedCandidateRun = completedCandidateRuns.get(item.run_id) ?? null;
      if (completedCandidateRun === null) {
        if (
          turnIds.has(item.turn_id)
          || runIds.has(item.run_id)
          || draftIds.has(item.draft_id)
        ) throw unavailable();
        turnIds.add(item.turn_id);
        runIds.add(item.run_id);
        draftIds.add(item.draft_id);
        continue;
      }
      if (
        completedCandidateRun.turn_id !== item.turn_id
        || completedCandidateRun.draft_id !== item.draft_id
        || completedCandidateRun.review !== null
      ) throw unavailable();
      completedCandidateRuns.set(item.run_id, {
        ...completedCandidateRun,
        review: item.decision,
      });
      continue;
    }

    if (item.item_kind === 'plan_reviewed') {
      if (activeTurn !== null) throw unavailable();
      const completedPlanRun = completedPlanRuns.get(item.run_id) ?? null;
      if (completedPlanRun === null) {
        if (turnIds.has(item.turn_id) || runIds.has(item.run_id)) throw unavailable();
        turnIds.add(item.turn_id);
        runIds.add(item.run_id);
        continue;
      }
      if (
        completedPlanRun.turn_id !== item.turn_id
        || completedPlanRun.review !== null
      ) throw unavailable();
      completedPlanRuns.set(item.run_id, {
        ...completedPlanRun,
        review: item.decision,
      });
      continue;
    }

    if (activeTurn === null) {
      if (!mayUsePrefixState) throw unavailable();
      if (turnIds.has(item.turn_id)) throw unavailable();
      turnIds.add(item.turn_id);
      if (item.item_kind === 'turn_completed') {
        if (item.run_id === null) throw unavailable();
        if (runIds.has(item.run_id)) throw unavailable();
        runIds.add(item.run_id);
        continue;
      }
      activeTurn = {
        turn_id: item.turn_id,
        mode: 'unknown',
        task_id: null,
        origin: 'prefix',
        submitted_message_id: null,
        submitted_text: null,
        current_run: null,
      };
    }
    if (activeTurn.turn_id !== item.turn_id) throw unavailable();

    if (item.item_kind === 'run_started') {
      if (runIds.has(item.run_id)) throw unavailable();
      const currentRun = activeTurn.current_run;
      if (activeTurn.mode === 'unknown') {
        if (item.task_id === null) {
          activeTurn.mode = 'question';
          activeTurn.task_id = null;
        } else {
          if (taskIds.has(item.task_id)) throw unavailable();
          taskIds.add(item.task_id);
          activeTurn.mode = 'work';
          activeTurn.task_id = item.task_id;
        }
      } else if (
        activeTurn.mode === 'work'
        && activeTurn.task_id === null
        && item.task_id !== null
      ) {
        if (taskIds.has(item.task_id)) throw unavailable();
        taskIds.add(item.task_id);
        activeTurn.task_id = item.task_id;
      }
      if (
        (activeTurn.mode === 'work' && item.task_id !== activeTurn.task_id)
        || (activeTurn.mode === 'question' && item.task_id !== null)
      ) throw unavailable();
      if (currentRun === null) {
        if (activeTurn.origin === 'visible') {
          if (item.attempt_number !== 1 || item.retry_of_run_id !== null) {
            throw unavailable();
          }
        } else if (
          (item.attempt_number === 1) !== (item.retry_of_run_id === null)
        ) {
          throw unavailable();
        }
      } else if (
        currentRun.status !== 'completed'
        || !['failed', 'interrupted', 'cancelled'].includes(
          currentRun.terminal_status as string,
        )
        || item.retry_of_run_id !== currentRun.run_id
        || (
          currentRun.attempt_number !== null
          && item.attempt_number !== currentRun.attempt_number + 1
        )
      ) {
        throw unavailable();
      }
      runIds.add(item.run_id);
      activeTurn.current_run = {
        run_id: item.run_id,
        attempt_number: item.attempt_number,
        status: 'running',
        terminal_status: null,
        result_kind: null,
        candidate_draft_id: null,
        plan_review: null,
        candidate_review: null,
        pending_tool_calls: 0,
        control: null,
        context_snapshot_recorded: false,
        programming_run_admitted: false,
        progress_stages: [],
        agent_step_progress: new Map(),
      };
      continue;
    }

    if (item.item_kind === 'run_context_snapshot_recorded') {
      if (activeTurn.mode === 'unknown') {
        if (item.task_id === null) {
          activeTurn.mode = 'question';
          activeTurn.task_id = null;
        } else {
          if (taskIds.has(item.task_id)) throw unavailable();
          taskIds.add(item.task_id);
          activeTurn.mode = 'work';
          activeTurn.task_id = item.task_id;
        }
      } else if (
        activeTurn.mode === 'work'
        && activeTurn.task_id === null
        && item.task_id !== null
      ) {
        if (taskIds.has(item.task_id)) throw unavailable();
        taskIds.add(item.task_id);
        activeTurn.task_id = item.task_id;
      }
      if (
        (activeTurn.mode === 'work' && item.task_id !== activeTurn.task_id)
        || (activeTurn.mode === 'question' && item.task_id !== null)
      ) throw unavailable();
      if (activeTurn.current_run === null) {
        if (activeTurn.origin !== 'prefix') throw unavailable();
        if (runIds.has(item.run_id)) throw unavailable();
        runIds.add(item.run_id);
        activeTurn.current_run = {
          run_id: item.run_id,
          attempt_number: null,
          status: 'running',
          terminal_status: null,
          result_kind: null,
          candidate_draft_id: null,
          plan_review: null,
          candidate_review: null,
          pending_tool_calls: 0,
          control: null,
          context_snapshot_recorded: false,
          programming_run_admitted: false,
          progress_stages: [],
          agent_step_progress: new Map(),
        };
      }
      const currentRun = activeTurn.current_run;
      if (
        currentRun.run_id !== item.run_id
        || currentRun.status !== 'running'
        || currentRun.control !== null
        || currentRun.context_snapshot_recorded
        || currentRun.progress_stages.length > 0
        || currentRun.pending_tool_calls > 0
      ) throw unavailable();
      currentRun.context_snapshot_recorded = true;
      continue;
    }

    if (item.item_kind === 'programming_run_admitted') {
      if (activeTurn.mode === 'unknown') {
        activeTurn.mode = 'work';
        activeTurn.task_id = item.task_id;
        if (taskIds.has(item.task_id)) throw unavailable();
        taskIds.add(item.task_id);
      }
      if (
        activeTurn.mode !== 'work'
        || activeTurn.task_id !== item.task_id
      ) throw unavailable();
      if (activeTurn.current_run === null) {
        if (activeTurn.origin !== 'prefix') throw unavailable();
        if (runIds.has(item.run_id)) throw unavailable();
        runIds.add(item.run_id);
        activeTurn.current_run = {
          run_id: item.run_id,
          attempt_number: null,
          status: 'running',
          terminal_status: null,
          result_kind: null,
          candidate_draft_id: null,
          plan_review: null,
          candidate_review: null,
          pending_tool_calls: 0,
          control: null,
          context_snapshot_recorded: false,
          programming_run_admitted: false,
          progress_stages: [],
          agent_step_progress: new Map(),
        };
      }
      const currentRun = activeTurn.current_run;
      if (
        currentRun.run_id !== item.run_id
        || currentRun.status !== 'running'
        || currentRun.control !== null
        || currentRun.programming_run_admitted
        || (!mayUsePrefixState && !currentRun.context_snapshot_recorded)
        || currentRun.progress_stages.length > 0
        || currentRun.pending_tool_calls > 0
      ) throw unavailable();
      currentRun.programming_run_admitted = true;
      continue;
    }

    if (item.item_kind === 'run_progress_recorded') {
      if (activeTurn.current_run === null) {
        if (activeTurn.origin !== 'prefix') throw unavailable();
        if (runIds.has(item.run_id)) throw unavailable();
        runIds.add(item.run_id);
        activeTurn.current_run = {
          run_id: item.run_id,
          attempt_number: null,
          status: 'running',
          terminal_status: null,
          result_kind: null,
          candidate_draft_id: null,
          plan_review: null,
          candidate_review: null,
          pending_tool_calls: 0,
          control: null,
          context_snapshot_recorded: false,
          programming_run_admitted: false,
          progress_stages: [],
          agent_step_progress: new Map(),
        };
      }
      const currentRun = activeTurn.current_run;
      const previousStage = currentRun.progress_stages.at(-1) ?? null;
      const previousIndex = previousStage === null ? -1 : RUN_PROGRESS_STAGES.indexOf(previousStage);
      const stageIndex = RUN_PROGRESS_STAGES.indexOf(item.stage);
      const expectedIndex = previousStage === null
        ? currentRun.attempt_number === null ? stageIndex : 0
        : previousIndex + 1;
      if (
        currentRun.run_id !== item.run_id
        || currentRun.status !== 'running'
        || currentRun.control !== null
        || (!mayUsePrefixState && stageIndex !== expectedIndex)
      ) throw unavailable();
      if (previousStage === null || stageIndex === expectedIndex) {
        currentRun.progress_stages.push(item.stage);
      }
      continue;
    }

    if (item.item_kind === 'agent_step_progress_recorded') {
      if (activeTurn.current_run === null) {
        if (activeTurn.origin !== 'prefix') throw unavailable();
        if (runIds.has(item.run_id)) throw unavailable();
        runIds.add(item.run_id);
        activeTurn.current_run = {
          run_id: item.run_id,
          attempt_number: null,
          status: 'running',
          terminal_status: null,
          result_kind: null,
          candidate_draft_id: null,
          plan_review: null,
          candidate_review: null,
          pending_tool_calls: 0,
          control: null,
          context_snapshot_recorded: false,
          programming_run_admitted: false,
          progress_stages: [],
          agent_step_progress: new Map(),
        };
      }
      if (activeTurn.mode === 'unknown') {
        if (taskIds.has(item.task_id)) throw unavailable();
        taskIds.add(item.task_id);
        activeTurn.mode = 'work';
        activeTurn.task_id = item.task_id;
      } else if (
        activeTurn.mode === 'work'
        && activeTurn.task_id === null
      ) {
        if (taskIds.has(item.task_id)) throw unavailable();
        taskIds.add(item.task_id);
        activeTurn.task_id = item.task_id;
      }
      if (
        activeTurn.mode !== 'work'
        || activeTurn.task_id !== item.task_id
      ) throw unavailable();
      const currentRun = activeTurn.current_run;
      if (currentRun === null) throw unavailable();
      recordAgentStepProgress(currentRun, item, mayUsePrefixState);
      continue;
    }

    if (item.item_kind === 'tool_call_requested') {
      if (activeTurn.current_run === null) {
        if (activeTurn.origin !== 'prefix') throw unavailable();
        if (runIds.has(item.run_id)) throw unavailable();
        runIds.add(item.run_id);
        activeTurn.current_run = {
          run_id: item.run_id,
          attempt_number: null,
          status: 'running',
          terminal_status: null,
          result_kind: null,
          candidate_draft_id: null,
          plan_review: null,
          candidate_review: null,
          pending_tool_calls: 0,
          control: null,
          context_snapshot_recorded: false,
          programming_run_admitted: false,
          progress_stages: [],
          agent_step_progress: new Map(),
        };
      }
      if (activeTurn.mode === 'unknown') activeTurn.mode = 'work';
      const currentRun = activeTurn.current_run;
      if (
        activeTurn.mode !== 'work'
        || currentRun.run_id !== item.run_id
        || currentRun.status !== 'running'
        || currentRun.control !== null
        || stepIds.has(item.step_id)
        || toolCallIds.has(item.tool_call_id)
      ) throw unavailable();
      stepIds.add(item.step_id);
      toolCallIds.add(item.tool_call_id);
      toolCallRequests.set(item.tool_call_id, {
        run_id: item.run_id,
        step_id: item.step_id,
        action: item.action,
        resource_kind: item.resource.resource_kind,
        result_recorded: false,
      });
      currentRun.pending_tool_calls += 1;
      continue;
    }

    if (item.item_kind === 'tool_call_result_recorded') {
      if (activeTurn.current_run === null) {
        if (activeTurn.origin !== 'prefix') throw unavailable();
        if (runIds.has(item.run_id)) throw unavailable();
        runIds.add(item.run_id);
        activeTurn.current_run = {
          run_id: item.run_id,
          attempt_number: null,
          status: 'running',
          terminal_status: null,
          result_kind: null,
          candidate_draft_id: null,
          plan_review: null,
          candidate_review: null,
          pending_tool_calls: 0,
          control: null,
          context_snapshot_recorded: false,
          programming_run_admitted: false,
          progress_stages: [],
          agent_step_progress: new Map(),
        };
      }
      if (activeTurn.mode === 'unknown') activeTurn.mode = 'work';
      const currentRun = activeTurn.current_run;
      const requested = toolCallRequests.get(item.tool_call_id) ?? null;
      const canDependOnOmittedRequest = requested === null && mayUsePrefixState;
      if (
        activeTurn.mode !== 'work'
        || currentRun.run_id !== item.run_id
        || currentRun.status !== 'running'
        || currentRun.control !== null
        || (stepIds.has(item.step_id) && requested === null)
        || (toolCallIds.has(item.tool_call_id) && requested === null)
        || (
          requested !== null
          && (
            requested.run_id !== item.run_id
            || requested.step_id !== item.step_id
            || requested.action !== item.action
            || requested.resource_kind !== item.resource.resource_kind
            || requested.result_recorded
          )
        )
        || (requested === null && !canDependOnOmittedRequest)
      ) throw unavailable();
      if (requested === null) {
        stepIds.add(item.step_id);
        toolCallIds.add(item.tool_call_id);
      } else {
        currentRun.pending_tool_calls -= 1;
        if (currentRun.pending_tool_calls < 0) throw unavailable();
      }
      toolCallRequests.set(item.tool_call_id, {
        run_id: item.run_id,
        step_id: item.step_id,
        action: item.action,
        resource_kind: item.resource.resource_kind,
        result_recorded: true,
      });
      continue;
    }

    if (item.item_kind === 'run_control_requested') {
      if (activeTurn.current_run === null) {
        if (activeTurn.origin !== 'prefix') throw unavailable();
        if (runIds.has(item.run_id)) throw unavailable();
        runIds.add(item.run_id);
        activeTurn.current_run = {
          run_id: item.run_id,
          attempt_number: null,
          status: 'running',
          terminal_status: null,
          result_kind: null,
          candidate_draft_id: null,
          plan_review: null,
          candidate_review: null,
          pending_tool_calls: 0,
          control: null,
          context_snapshot_recorded: false,
          programming_run_admitted: false,
          progress_stages: [],
          agent_step_progress: new Map(),
        };
      }
      const currentRun = activeTurn.current_run;
      if (
        currentRun.run_id !== item.run_id
        || currentRun.status !== 'running'
        || currentRun.control !== null
      ) throw unavailable();
      currentRun.control = item.action;
      continue;
    }

    if (item.item_kind === 'run_completed') {
      if (activeTurn.current_run === null) {
        if (activeTurn.origin !== 'prefix') throw unavailable();
        if (runIds.has(item.run_id)) throw unavailable();
        runIds.add(item.run_id);
        activeTurn.current_run = {
          run_id: item.run_id,
          attempt_number: null,
          status: 'running',
          terminal_status: null,
          result_kind: null,
          candidate_draft_id: null,
          plan_review: null,
          candidate_review: null,
          pending_tool_calls: 0,
          control: mayUsePrefixState ? 'unknown' : null,
          context_snapshot_recorded: false,
          programming_run_admitted: false,
          progress_stages: [],
          agent_step_progress: new Map(),
        };
      }
      const currentRun = activeTurn.current_run;
      if (
        currentRun.run_id !== item.run_id
        || currentRun.status !== 'running'
        || !resultMatchesMode(activeTurn.mode, item)
        || !failurePhaseMatchesRun(currentRun, item, mayUsePrefixState)
        || (currentRun.control === 'cancel' && item.terminal_status !== 'cancelled')
        || (
          currentRun.control === 'interrupt'
          && item.terminal_status !== 'interrupted'
        )
        || (
          currentRun.control === null
          && ['cancelled', 'interrupted'].includes(item.terminal_status)
        )
        || (currentRun.pending_tool_calls > 0 && item.terminal_status === 'succeeded')
      ) throw unavailable();
      if (item.assistant_message !== null) {
        if (messageIds.has(item.assistant_message.message_id)) throw unavailable();
        messageIds.add(item.assistant_message.message_id);
      }
      if (item.candidate !== null) {
        if (draftIds.has(item.candidate.draft_id)) throw unavailable();
        draftIds.add(item.candidate.draft_id);
      }
      currentRun.status = 'completed';
      currentRun.terminal_status = item.terminal_status;
      currentRun.result_kind = item.result_kind;
      currentRun.candidate_draft_id = item.candidate?.draft_id ?? null;
      continue;
    }

    if (item.item_kind === 'task_brief_updated') {
      if (activeTurn.current_run === null) {
        if (activeTurn.origin !== 'prefix' || !mayUsePrefixState) throw unavailable();
        if (runIds.has(item.run_id)) throw unavailable();
        runIds.add(item.run_id);
        activeTurn.mode = 'question';
        activeTurn.current_run = {
          run_id: item.run_id,
          attempt_number: null,
          status: 'completed',
          terminal_status: 'succeeded',
          result_kind: 'explanation',
          candidate_draft_id: null,
          plan_review: null,
          candidate_review: null,
          pending_tool_calls: 0,
          control: null,
          context_snapshot_recorded: false,
          programming_run_admitted: false,
          progress_stages: [],
          agent_step_progress: new Map(),
        };
      }
      const currentRun = activeTurn.current_run;
      if (
        activeTurn.mode !== 'question'
        || activeTurn.task_id !== null
        || currentRun.run_id !== item.run_id
        || currentRun.status !== 'completed'
        || currentRun.terminal_status !== 'succeeded'
        || currentRun.result_kind !== 'explanation'
        || taskIds.has(item.task.task_id)
        || item.brief.status !== 'ready'
        || !item.brief.contextual_build_ready
      ) throw unavailable();
      taskIds.add(item.task.task_id);
      continue;
    }

    const currentRun = activeTurn.current_run;
    if (
      item.run_id === null
      || currentRun === null
      || currentRun.run_id !== item.run_id
      || currentRun.status !== 'completed'
      || !expectedSuffixOutcome(activeTurn, currentRun, item.outcome)
    ) throw unavailable();
    if (
      currentRun.terminal_status === 'succeeded'
      && currentRun.result_kind === 'candidate'
      && currentRun.candidate_draft_id !== null
    ) {
      completedCandidateRuns.set(currentRun.run_id, {
        turn_id: activeTurn.turn_id,
        draft_id: currentRun.candidate_draft_id,
        review: currentRun.candidate_review,
      });
    }
    if (
      currentRun.terminal_status === 'succeeded'
      && currentRun.result_kind === 'plan'
    ) {
      completedPlanRuns.set(currentRun.run_id, {
        turn_id: activeTurn.turn_id,
        review: currentRun.plan_review,
      });
    }
    activeTurn = null;
  }

  if ((activeTurn?.turn_id ?? null) !== recordedActiveTurnId) throw unavailable();
}

function sanitizeAuthority(value: unknown): BuilderConversationAuthority {
  const source = exactRecord(value, AUTHORITY_KEYS);
  if (
    source.conversation !== 'sqlite_canonical_event_replay_or_absent'
    || source.project_source !== 'not_included'
    || source.candidate_source !== 'not_loaded'
    || source.project_revision !== 'not_inferred'
  ) throw unavailable();
  return {
    conversation: 'sqlite_canonical_event_replay_or_absent',
    project_source: 'not_included',
    candidate_source: 'not_loaded',
    project_revision: 'not_inferred',
  };
}

function ensurePublicBudget(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw unavailable();
  }
  if (TEXT_ENCODER.encode(serialized).byteLength > MAX_PUBLIC_BYTES) throw unavailable();
}

export function sanitizeBuilderConversationSnapshot(
  value: unknown,
): BuilderConversationSnapshot {
  try {
    const source = exactRecordWithOptional(value, TOP_LEVEL_KEYS, TOP_LEVEL_OPTIONAL_KEYS);
    if (source.stream_version !== BUILDER_TASK_STREAM_READ_RESULT_VERSION) {
      throw unavailable();
    }
    const projectId = safeProjectId(source.project_id);
    const authority = sanitizeAuthority(source.authority);
    const contextStatusProjection = optionalContextStatusProjection(source);
    const providerContextDisclosureStatusProjection =
      optionalProviderContextDisclosureStatusProjection(source);
    const draftCheckpointStatusProjection = optionalDraftCheckpointStatusProjection(source);
    const reviewStateProjection = optionalReviewStateProjection(source);
    const checkRunOutcomeProjection = optionalCheckRunOutcomeProjection(source);
    const agentActivityProjection = optionalAgentActivityProjection(source);
    if (source.conversation === null) {
      if (reviewStateProjection !== undefined && reviewStateProjection !== null) throw unavailable();
      if (checkRunOutcomeProjection !== undefined && checkRunOutcomeProjection !== null) throw unavailable();
      if (agentActivityProjection !== undefined && agentActivityProjection !== null) throw unavailable();
      const absent = {
        state: 'absent' as const,
        stream_version: BUILDER_TASK_STREAM_READ_RESULT_VERSION,
        project_id: projectId,
        ...(contextStatusProjection === undefined
          ? {}
          : { context_status_projection: contextStatusProjection }),
        ...(providerContextDisclosureStatusProjection === undefined
          ? {}
          : {
            provider_context_disclosure_status_projection:
              providerContextDisclosureStatusProjection,
          }),
        ...(draftCheckpointStatusProjection === undefined
          ? {}
          : { draft_checkpoint_status_projection: draftCheckpointStatusProjection }),
        ...(reviewStateProjection === undefined
          ? {}
          : { review_state_projection: reviewStateProjection }),
        ...(checkRunOutcomeProjection === undefined
          ? {}
          : { check_run_outcome_projection: checkRunOutcomeProjection }),
        ...(agentActivityProjection === undefined
          ? {}
          : { agent_activity_projection: agentActivityProjection }),
        conversation: null,
        authority,
      };
      ensurePublicBudget(absent);
      return deepFreeze(absent);
    }

    const conversationSource = exactRecord(source.conversation, CONVERSATION_KEYS);
    const conversationId = safeConversationId(
      conversationSource.conversation_id,
      projectId,
    );
    const createdAtMs = safeTimestamp(conversationSource.created_at_ms);
    const headSequence = safeSequence(conversationSource.head_sequence);
    const recordedActiveTurnId = nullableId(
      conversationSource.recorded_active_turn_id,
      TURN_ID_PATTERN,
    );
    const windowSource = exactRecord(conversationSource.window, WINDOW_KEYS);
    const firstSequence = safeSequence(windowSource.first_sequence);
    const lastSequence = safeSequence(windowSource.last_sequence);
    if (typeof windowSource.has_earlier !== 'boolean') throw unavailable();
    const rawItems = denseArray(conversationSource.items);
    const items = rawItems.map((item) => sanitizeItem(item));
    if (
      firstSequence !== items[0].sequence
      || lastSequence !== items.at(-1)?.sequence
      || headSequence !== lastSequence
      || windowSource.has_earlier !== (firstSequence > 1)
      || (
        windowSource.has_earlier
          ? items.length !== MAX_PUBLIC_ITEMS
          : firstSequence !== 1
      )
      || items.some((item, index) => item.sequence !== firstSequence + index)
    ) throw unavailable();
    if (
      agentActivityProjection !== undefined
      && agentActivityProjection !== null
      && (
        agentActivityProjection.project_id !== projectId
        || agentActivityProjection.conversation_id !== conversationId
        || agentActivityProjection.head_sequence !== headSequence
      )
    ) throw unavailable();
    if (windowSource.has_earlier) {
      validateTruncatedWindow(items, recordedActiveTurnId);
    } else {
      validateCompleteWindow(items, recordedActiveTurnId);
    }
    const ready = {
      state: 'ready' as const,
      stream_version: BUILDER_TASK_STREAM_READ_RESULT_VERSION,
      project_id: projectId,
      ...(contextStatusProjection === undefined
        ? {}
        : { context_status_projection: contextStatusProjection }),
      ...(providerContextDisclosureStatusProjection === undefined
        ? {}
        : {
          provider_context_disclosure_status_projection:
            providerContextDisclosureStatusProjection,
        }),
      ...(draftCheckpointStatusProjection === undefined
        ? {}
        : { draft_checkpoint_status_projection: draftCheckpointStatusProjection }),
      ...(reviewStateProjection === undefined
        ? {}
        : { review_state_projection: reviewStateProjection }),
      ...(checkRunOutcomeProjection === undefined
        ? {}
        : { check_run_outcome_projection: checkRunOutcomeProjection }),
      ...(agentActivityProjection === undefined
        ? {}
        : { agent_activity_projection: agentActivityProjection }),
      conversation: {
        conversation_id: conversationId,
        created_at_ms: createdAtMs,
        head_sequence: headSequence,
        recorded_active_turn_id: recordedActiveTurnId,
        window: {
          first_sequence: firstSequence,
          last_sequence: lastSequence,
          has_earlier: windowSource.has_earlier,
        },
        items,
      },
      authority,
    };
    ensurePublicBudget(ready);
    return deepFreeze(ready);
  } catch (error) {
    if (error instanceof BuilderConversationSnapshotError) throw error;
    throw unavailable();
  }
}
