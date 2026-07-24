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

export type BuilderConversationItem =
  | Readonly<{
    item_kind: 'user_message';
    sequence: number;
    turn_id: string;
    message: BuilderConversationMessage;
    message_kind: 'submitted' | 'steering';
    mode: 'question' | 'work' | null;
    task: BuilderConversationTask | null;
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
    item_kind: 'run_control_requested';
    sequence: number;
    turn_id: string;
    run_id: string;
    action: 'cancel' | 'interrupt';
  }>
  | Readonly<{
    item_kind: 'run_completed';
    sequence: number;
    turn_id: string;
    run_id: string;
    terminal_status: 'succeeded' | 'failed' | 'interrupted' | 'cancelled';
    result_kind: 'explanation' | 'plan' | 'candidate' | 'failure';
    assistant_message: BuilderConversationMessage | null;
    candidate: BuilderConversationCandidate | null;
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
const RUN_CONTROL_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'action',
]);
const RUN_COMPLETED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'terminal_status',
  'result_kind',
  'assistant_message',
  'candidate',
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
const CANDIDATE_KEYS = Object.freeze([
  'draft_id',
  'title',
  'summary',
  'candidate_state',
  'source_availability',
]);

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

function sanitizeUserMessage(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'user_message' }> {
  const messageKind = source.message_kind;
  const mode = source.mode;
  const task = sanitizeTask(source.task);
  if (messageKind !== 'submitted' && messageKind !== 'steering') throw unavailable();
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

function sanitizeRunCompleted(
  source: Record<string, unknown>,
  sequence: number,
): Extract<BuilderConversationItem, { item_kind: 'run_completed' }> {
  const terminalStatus = source.terminal_status;
  const resultKind = source.result_kind;
  if (
    !['succeeded', 'failed', 'interrupted', 'cancelled'].includes(
      terminalStatus as string,
    )
    || !['explanation', 'plan', 'candidate', 'failure'].includes(
      resultKind as string,
    )
    || (terminalStatus === 'succeeded') !== (resultKind !== 'failure')
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
    assistant_message: assistantMessage,
    candidate,
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
  } else if (itemKind === 'run_started') {
    source = exactRecord(value, RUN_STARTED_KEYS);
  } else if (itemKind === 'run_control_requested') {
    source = exactRecord(value, RUN_CONTROL_KEYS);
  } else if (itemKind === 'run_completed') {
    source = exactRecord(value, RUN_COMPLETED_KEYS);
  } else if (itemKind === 'turn_completed') {
    source = exactRecord(value, TURN_COMPLETED_KEYS);
  } else {
    throw unavailable();
  }
  const sequence = safeSequence(source.sequence);
  if (itemKind === 'user_message') return sanitizeUserMessage(source, sequence);
  if (itemKind === 'run_started') return sanitizeRunStarted(source, sequence);
  if (itemKind === 'run_control_requested') return sanitizeRunControl(source, sequence);
  if (itemKind === 'run_completed') return sanitizeRunCompleted(source, sequence);
  return sanitizeTurnCompleted(source, sequence);
}

type ReplayTurn = {
  turn_id: string;
  mode: 'question' | 'work';
  task: BuilderConversationTask | null;
  runs: Array<{
    run_id: string;
    attempt_number: number;
    status: 'running' | 'completed';
    terminal_status: 'succeeded' | 'failed' | 'interrupted' | 'cancelled' | null;
    result_kind: 'explanation' | 'plan' | 'candidate' | 'failure' | null;
    control: 'cancel' | 'interrupt' | null;
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

function validateCompleteWindow(
  items: readonly BuilderConversationItem[],
  recordedActiveTurnId: string | null,
): void {
  const turns = new Map<string, ReplayTurn>();
  const messageIds = new Set<string>();
  const taskIds = new Set<string>();
  const runIds = new Set<string>();
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
      }
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
        control: null,
      });
      continue;
    }
    if (currentRun === null || currentRun.run_id !== item.run_id) throw unavailable();
    if (item.item_kind === 'run_control_requested') {
      if (currentRun.status !== 'running' || currentRun.control !== null) throw unavailable();
      currentRun.control = item.action;
      continue;
    }
    if (item.item_kind === 'run_completed') {
      if (
        currentRun.status !== 'running'
        || !resultMatchesMode(activeTurn.mode, item)
      ) throw unavailable();
      if (
        (currentRun.control === 'cancel' && item.terminal_status !== 'cancelled')
        || (currentRun.control === 'interrupt' && item.terminal_status !== 'interrupted')
        || (currentRun.control === null
          && (item.terminal_status === 'cancelled' || item.terminal_status === 'interrupted'))
      ) throw unavailable();
      if (item.assistant_message !== null) {
        if (messageIds.has(item.assistant_message.message_id)) throw unavailable();
        messageIds.add(item.assistant_message.message_id);
      }
      currentRun.status = 'completed';
      currentRun.terminal_status = item.terminal_status;
      currentRun.result_kind = item.result_kind;
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
  control: 'cancel' | 'interrupt' | 'unknown' | null;
};

type SuffixTurn = {
  turn_id: string;
  mode: 'question' | 'work' | 'unknown';
  task_id: string | null;
  origin: 'visible' | 'prefix';
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
      }
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
        control: null,
      };
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
          control: null,
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
          control: mayUsePrefixState ? 'unknown' : null,
        };
      }
      const currentRun = activeTurn.current_run;
      if (
        currentRun.run_id !== item.run_id
        || currentRun.status !== 'running'
        || !resultMatchesMode(activeTurn.mode, item)
        || (currentRun.control === 'cancel' && item.terminal_status !== 'cancelled')
        || (
          currentRun.control === 'interrupt'
          && item.terminal_status !== 'interrupted'
        )
        || (
          currentRun.control === null
          && ['cancelled', 'interrupted'].includes(item.terminal_status)
        )
      ) throw unavailable();
      if (item.assistant_message !== null) {
        if (messageIds.has(item.assistant_message.message_id)) throw unavailable();
        messageIds.add(item.assistant_message.message_id);
      }
      currentRun.status = 'completed';
      currentRun.terminal_status = item.terminal_status;
      currentRun.result_kind = item.result_kind;
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
    const source = exactRecord(value, TOP_LEVEL_KEYS);
    if (source.stream_version !== BUILDER_TASK_STREAM_READ_RESULT_VERSION) {
      throw unavailable();
    }
    const projectId = safeProjectId(source.project_id);
    const authority = sanitizeAuthority(source.authority);
    if (source.conversation === null) {
      const absent = {
        state: 'absent' as const,
        stream_version: BUILDER_TASK_STREAM_READ_RESULT_VERSION,
        project_id: projectId,
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
    if (windowSource.has_earlier) {
      validateTruncatedWindow(items, recordedActiveTurnId);
    } else {
      validateCompleteWindow(items, recordedActiveTurnId);
    }
    const ready = {
      state: 'ready' as const,
      stream_version: BUILDER_TASK_STREAM_READ_RESULT_VERSION,
      project_id: projectId,
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
