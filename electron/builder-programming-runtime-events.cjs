'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');
const {
  CONVERSATION_ID_PATTERN,
} = require('./builder-conversation-address.cjs');

const BUILDER_PROGRAMMING_RUNTIME_EVENT_VERSION =
  'builder-programming-runtime-event.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ID_PATTERNS = Object.freeze({
  project: new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u'),
  conversation: CONVERSATION_ID_PATTERN,
  run: new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u'),
  turn: new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u'),
  step: new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u'),
  tool: new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u'),
  message: new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u'),
  event: /^builder-programming-runtime-event:[0-9a-f]{64}$/u,
  result_ref: /^builder-runtime-tool-result:[0-9a-f]{64}$/u,
  change_ref: /^builder-runtime-file-change:[0-9a-f]{64}$/u,
  command_ref: /^builder-runtime-command-result:[0-9a-f]{64}$/u,
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RUNTIME_EVENT_REF_PATTERN = /^[a-z][a-z0-9_.:-]{2,127}$/u;
const RESOURCE_ID_PATTERN = /^project:\/[a-zA-Z0-9._@/ -]{1,240}$/u;
const UNSAFE_UNICODE_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_ABSOLUTE_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)))/u;
const CREDENTIAL_PATTERN = /(?:api[_-]?key|access[_-]?token|authorization|password|secret|credential|private[_-]?key)\s*[:=]/iu;

const EVENT_CANDIDATE_KEYS = Object.freeze([
  'protocol_version',
  'runtime_event_ref',
  'run_id',
  'occurred_at_ms',
  'turn_id',
  'step_id',
  'tool_call_id',
  'event_type',
  'payload',
]);
const EVENT_KEYS = Object.freeze([
  'event_version',
  'protocol_version',
  'event_id',
  'event_digest',
  'sequence',
  'previous_event',
  'occurred_at_ms',
  'normalized_at_ms',
  'project_id',
  'conversation_id',
  'run_id',
  'runtime_kind',
  'event_source',
  'runtime_event_ref',
  'turn_id',
  'step_id',
  'tool_call_id',
  'event_type',
  'payload',
  'run_contract_digest',
]);
const PREVIOUS_EVENT_KEYS = Object.freeze(['sequence', 'event_id', 'event_digest']);
const EVENT_TYPES = Object.freeze([
  'run_started',
  'turn_started',
  'step_started',
  'assistant_text_delta',
  'assistant_text_discarded',
  'assistant_text_completed',
  'assistant_reasoning_status',
  'runtime_activity_status',
  'model_usage_recorded',
  'model_finish_recorded',
  'tool_call_started',
  'tool_call_updated',
  'tool_call_completed',
  'tool_call_failed',
  'file_change_recorded',
  'check_result_recorded',
  'step_completed',
  'turn_completed',
  'run_blocked',
  'run_cancelled',
  'run_failed',
  'run_completed',
]);
const TOOL_KINDS = Object.freeze([
  'read', 'search', 'edit', 'write', 'command', 'browser', 'question',
]);

class BuilderProgrammingRuntimeEventError extends Error {
  constructor(code = 'builder_programming_runtime_event_invalid') {
    const selected = [
      'builder_programming_runtime_event_invalid',
      'builder_programming_runtime_event_conflict',
      'builder_programming_runtime_event_closed',
    ].includes(code) ? code : 'builder_programming_runtime_event_invalid';
    const messages = {
      builder_programming_runtime_event_invalid:
        'The programming runtime event could not be verified.',
      builder_programming_runtime_event_conflict:
        'The programming runtime event conflicts with the current run.',
      builder_programming_runtime_event_closed:
        'The programming runtime run is already closed.',
    };
    super(messages[selected]);
    this.name = 'BuilderProgrammingRuntimeEventError';
    this.code = selected;
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProgrammingRuntimeEventError(code);
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function exactObjectWithOptional(value, requiredKeys, optionalKeys) {
  if (!isPlainObject(value)) fail();
  const allowed = [...requiredKeys, ...optionalKeys];
  const actual = Reflect.ownKeys(value);
  if (
    actual.some((key) => typeof key !== 'string' || !allowed.includes(key))
    || requiredKeys.some((key) => !actual.includes(key))
  ) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function safeToolPresentationDetail(value) {
  if (value === null) return null;
  if (!isPlainObject(value)) fail();
  const kind = valueAt(value, 'detail_kind');
  if (kind === 'read') {
    const source = exactObject(value, [
      'detail_kind', 'path', 'offset', 'returned_lines', 'total_lines', 'first_line', 'last_line', 'language_hint',
    ]);
    const firstLine = valueAt(source, 'first_line');
    const lastLine = valueAt(source, 'last_line');
    const languageHint = valueAt(source, 'language_hint');
    return freezeDeep({
      detail_kind: 'read',
      path: safeLabel(valueAt(source, 'path'), 240),
      offset: safeInteger(valueAt(source, 'offset'), 1, 1_000_000),
      returned_lines: safeInteger(valueAt(source, 'returned_lines'), 0, 1_000_000),
      total_lines: safeInteger(valueAt(source, 'total_lines'), 0, 1_000_000),
      first_line: firstLine === null ? null : safeInteger(firstLine, 1, 1_000_000),
      last_line: lastLine === null ? null : safeInteger(lastLine, 1, 1_000_000),
      language_hint: languageHint === null ? null : safeLabel(languageHint, 32),
    });
  }
  if (kind === 'search') {
    const source = exactObject(value, [
      'detail_kind', 'matches', 'truncated', 'total',
    ]);
    const rawMatches = valueAt(source, 'matches');
    if (!Array.isArray(rawMatches) || rawMatches.length > 100) fail();
    const matches = rawMatches.map((rawMatch) => {
      const match = exactObject(rawMatch, ['path', 'line', 'column']);
      return {
        path: safeLabel(valueAt(match, 'path'), 240),
        line: safeInteger(valueAt(match, 'line'), 0, 1_000_000),
        column: safeInteger(valueAt(match, 'column'), 0, 1_000_000),
      };
    });
    return freezeDeep({
      detail_kind: 'search',
      matches,
      truncated: safeBoolean(valueAt(source, 'truncated')),
      total: safeInteger(valueAt(source, 'total'), 0, 1_000_000),
    });
  }
  if (kind === 'diff') {
    const source = exactObject(value, [
      'detail_kind', 'path', 'added_lines', 'deleted_lines',
    ]);
    return freezeDeep({
      detail_kind: 'diff',
      path: safeLabel(valueAt(source, 'path'), 240),
      added_lines: safeInteger(valueAt(source, 'added_lines'), 0, 1_000_000),
      deleted_lines: safeInteger(valueAt(source, 'deleted_lines'), 0, 1_000_000),
    });
  }
  if (kind === 'command') {
    const source = exactObject(value, [
      'detail_kind', 'status', 'command', 'exit_code', 'duration_ms', 'truncated',
    ]);
    const exitCode = valueAt(source, 'exit_code');
    return freezeDeep({
      detail_kind: 'command',
      status: safeEnum(valueAt(source, 'status'), [
        'passed', 'failed', 'timed_out', 'cancelled', 'output_exceeded',
        'environment_unavailable', 'spawn_failed', 'termination_failed',
      ]),
      command: safeLabel(valueAt(source, 'command'), 160),
      exit_code: exitCode === null ? null : safeInteger(exitCode, 0, 255),
      duration_ms: safeInteger(valueAt(source, 'duration_ms'), 0, 60 * 60 * 1_000),
      truncated: safeBoolean(valueAt(source, 'truncated')),
    });
  }
  fail();
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

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isPlainObject(value)) fail();
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
  ).join(',')}}`;
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function digestText(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeEnum(value, options) {
  if (typeof value !== 'string' || !options.includes(value)) fail();
  return value;
}

function safeInteger(value, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function safeBoolean(value) {
  if (typeof value !== 'boolean') fail();
  return value;
}

function hasUnsafeText(value) {
  if (UNSAFE_UNICODE_PATTERN.test(value) || CREDENTIAL_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x08 || (code >= 0x0b && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function safeText(value, maximumCodePoints, maximumBytes, allowFormatting = false) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.normalize('NFC') !== value
    || hasUnsafeText(value)
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) fail();
  if (!allowFormatting && /[\r\n\t]/u.test(value)) fail();
  return value;
}

function safeLabel(value, maximum = 240) {
  const label = safeText(value, maximum, maximum * 4, false);
  if (label.trim() !== label || LOCAL_ABSOLUTE_PATH_PATTERN.test(label)) fail();
  return label;
}

function nullableId(value, pattern) {
  return value === null ? null : safePattern(value, pattern);
}

function sanitizePayload(eventType, value) {
  if (eventType === 'run_started') {
    const source = exactObject(value, ['mode']);
    return freezeDeep({ mode: safeEnum(valueAt(source, 'mode'), ['ask', 'plan', 'build']) });
  }
  if (eventType === 'turn_started') {
    const source = exactObject(value, ['message_id']);
    return freezeDeep({ message_id: safePattern(valueAt(source, 'message_id'), ID_PATTERNS.message) });
  }
  if (eventType === 'step_started') {
    const source = exactObject(value, ['step_index']);
    return freezeDeep({ step_index: safeInteger(valueAt(source, 'step_index'), 1, 128) });
  }
  if (eventType === 'assistant_text_delta') {
    const source = exactObject(value, ['message_id', 'delta_text']);
    return freezeDeep({
      message_id: safePattern(valueAt(source, 'message_id'), ID_PATTERNS.message),
      delta_text: safeText(valueAt(source, 'delta_text'), 8_192, 16 * 1_024, true),
    });
  }
  if (eventType === 'assistant_text_discarded') {
    const source = exactObject(value, ['message_id', 'text_digest', 'text_bytes']);
    return freezeDeep({
      message_id: safePattern(valueAt(source, 'message_id'), ID_PATTERNS.message),
      text_digest: safePattern(valueAt(source, 'text_digest'), DIGEST_PATTERN),
      text_bytes: safeInteger(valueAt(source, 'text_bytes'), 1, 2 * 1_024 * 1_024),
    });
  }
  if (eventType === 'assistant_text_completed') {
    const source = exactObject(value, ['message_id', 'text_digest', 'text_bytes']);
    return freezeDeep({
      message_id: safePattern(valueAt(source, 'message_id'), ID_PATTERNS.message),
      text_digest: safePattern(valueAt(source, 'text_digest'), DIGEST_PATTERN),
      text_bytes: safeInteger(valueAt(source, 'text_bytes'), 1, 2 * 1_024 * 1_024),
    });
  }
  if (eventType === 'assistant_reasoning_status') {
    const source = exactObject(value, ['status']);
    return freezeDeep({ status: safeLabel(valueAt(source, 'status'), 160) });
  }
  if (eventType === 'runtime_activity_status') {
    const source = exactObject(value, ['activity_kind', 'status']);
    return freezeDeep({
      activity_kind: safeEnum(valueAt(source, 'activity_kind'), [
        'session_running',
        'session_idle',
        'turn_preparing',
        'step_analyzing',
        'model_retry_waiting',
        'model_retrying',
        'context_compacting',
        'context_compacted',
        'todo_updated',
        'subagent_started',
        'subagent_finished',
        'generation_finishing',
      ]),
      status: safeLabel(valueAt(source, 'status'), 160),
    });
  }
  if (eventType === 'model_usage_recorded') {
    const source = exactObject(value, [
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'reasoning_tokens',
    ]);
    const optionalCount = (count) => count === null ? null : safeInteger(count, 0, 1_000_000_000);
    return freezeDeep({
      input_tokens: safeInteger(valueAt(source, 'input_tokens'), 0, 1_000_000_000),
      output_tokens: safeInteger(valueAt(source, 'output_tokens'), 0, 1_000_000_000),
      cache_read_tokens: optionalCount(valueAt(source, 'cache_read_tokens')),
      cache_write_tokens: optionalCount(valueAt(source, 'cache_write_tokens')),
      reasoning_tokens: optionalCount(valueAt(source, 'reasoning_tokens')),
    });
  }
  if (eventType === 'model_finish_recorded') {
    const source = exactObject(value, ['reason_kind']);
    return freezeDeep({
      reason_kind: safeEnum(valueAt(source, 'reason_kind'), [
        'stop',
        'tool-calls',
        'max-tokens',
        'aborted',
        'error',
      ]),
    });
  }
  if (eventType === 'tool_call_started') {
    const source = exactObject(value, [
      'tool_kind',
      'active_label',
      'completed_label',
      'target_label',
      'presentation',
      'argument_digest',
    ]);
    const target = valueAt(source, 'target_label');
    return freezeDeep({
      tool_kind: safeEnum(valueAt(source, 'tool_kind'), TOOL_KINDS),
      active_label: safeLabel(valueAt(source, 'active_label')),
      completed_label: safeLabel(valueAt(source, 'completed_label')),
      target_label: target === null ? null : safeLabel(target),
      presentation: safeEnum(
        valueAt(source, 'presentation'),
        ['file', 'changes', 'terminal', 'search', 'browser', 'question'],
      ),
      argument_digest: safePattern(valueAt(source, 'argument_digest'), DIGEST_PATTERN),
    });
  }
  if (eventType === 'tool_call_updated') {
    const source = exactObject(value, ['status_label']);
    return freezeDeep({ status_label: safeLabel(valueAt(source, 'status_label')) });
  }
  if (eventType === 'tool_call_completed') {
    const source = exactObjectWithOptional(
      value,
      ['duration_ms', 'result_kind', 'result_ref', 'summary'],
      ['presentation_detail'],
    );
    return freezeDeep({
      duration_ms: safeInteger(valueAt(source, 'duration_ms'), 0, 60 * 60 * 1_000),
      result_kind: safeEnum(valueAt(source, 'result_kind'), TOOL_KINDS),
      result_ref: safePattern(valueAt(source, 'result_ref'), ID_PATTERNS.result_ref),
      summary: safeLabel(valueAt(source, 'summary'), 360),
      ...(Object.hasOwn(source, 'presentation_detail')
        ? { presentation_detail: safeToolPresentationDetail(valueAt(source, 'presentation_detail')) }
        : {}),
    });
  }
  if (eventType === 'tool_call_failed') {
    const source = exactObject(value, ['duration_ms', 'failure_class', 'safe_message']);
    return freezeDeep({
      duration_ms: safeInteger(valueAt(source, 'duration_ms'), 0, 60 * 60 * 1_000),
      failure_class: safeEnum(valueAt(source, 'failure_class'), [
        'denied',
        'invalid_input',
        'stale_file',
        'not_found',
        'timeout',
        'cancelled',
        'check_failed',
        'environment_unavailable',
        'runtime_failure',
      ]),
      safe_message: safeLabel(valueAt(source, 'safe_message'), 360),
    });
  }
  if (eventType === 'file_change_recorded') {
    const source = exactObject(value, [
      'change_ref',
      'resource_id',
      'change_kind',
      'added_lines',
      'deleted_lines',
    ]);
    return freezeDeep({
      change_ref: safePattern(valueAt(source, 'change_ref'), ID_PATTERNS.change_ref),
      resource_id: safePattern(valueAt(source, 'resource_id'), RESOURCE_ID_PATTERN),
      change_kind: safeEnum(valueAt(source, 'change_kind'), ['added', 'edited', 'deleted']),
      added_lines: safeInteger(valueAt(source, 'added_lines'), 0, 1_000_000),
      deleted_lines: safeInteger(valueAt(source, 'deleted_lines'), 0, 1_000_000),
    });
  }
  if (eventType === 'check_result_recorded') {
    const source = exactObject(value, ['command_ref', 'status', 'duration_ms', 'summary']);
    return freezeDeep({
      command_ref: safePattern(valueAt(source, 'command_ref'), ID_PATTERNS.command_ref),
      status: safeEnum(valueAt(source, 'status'), ['passed', 'failed', 'incomplete', 'not_run']),
      duration_ms: safeInteger(valueAt(source, 'duration_ms'), 0, 60 * 60 * 1_000),
      summary: safeLabel(valueAt(source, 'summary'), 360),
    });
  }
  if (eventType === 'step_completed') {
    const source = exactObject(value, ['outcome']);
    return freezeDeep({ outcome: safeEnum(valueAt(source, 'outcome'), ['completed', 'failed']) });
  }
  if (eventType === 'turn_completed') {
    const source = exactObject(value, ['outcome']);
    return freezeDeep({ outcome: safeEnum(valueAt(source, 'outcome'), ['completed', 'failed']) });
  }
  if (eventType === 'run_blocked') {
    const source = exactObject(value, ['blocker_class', 'safe_message']);
    return freezeDeep({
      blocker_class: safeEnum(valueAt(source, 'blocker_class'), [
        'permission_required',
        'user_input_required',
        'workspace_unavailable',
      ]),
      safe_message: safeLabel(valueAt(source, 'safe_message'), 360),
    });
  }
  if (eventType === 'run_cancelled' || eventType === 'run_failed') {
    const source = exactObject(value, ['failure_class', 'safe_message']);
    return freezeDeep({
      failure_class: safeEnum(valueAt(source, 'failure_class'), [
        'cancelled',
        'timeout',
        'provider_failure',
        'runtime_failure',
        'invalid_event',
        'runtime_idle_timeout',
        'run_limit_reached',
      ]),
      safe_message: safeLabel(valueAt(source, 'safe_message'), 360),
    });
  }
  if (eventType === 'run_completed') {
    const source = exactObject(value, ['outcome', 'checkpoint_status']);
    return freezeDeep({
      outcome: safeEnum(valueAt(source, 'outcome'), ['answered', 'planned', 'built']),
      checkpoint_status: safeEnum(
        valueAt(source, 'checkpoint_status'),
        ['not_applicable', 'created', 'updated'],
      ),
    });
  }
  fail();
}

function sanitizeCandidate(rawCandidate, runContract) {
  const source = exactObject(rawCandidate, EVENT_CANDIDATE_KEYS);
  if (valueAt(source, 'protocol_version') !== BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION) fail();
  const eventType = safeEnum(valueAt(source, 'event_type'), EVENT_TYPES);
  const runId = safePattern(valueAt(source, 'run_id'), ID_PATTERNS.run);
  if (runId !== runContract.admission.run_id) fail('builder_programming_runtime_event_conflict');
  return freezeDeep({
    protocol_version: BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
    runtime_event_ref: safePattern(
      valueAt(source, 'runtime_event_ref'),
      RUNTIME_EVENT_REF_PATTERN,
    ),
    run_id: runId,
    occurred_at_ms: safeInteger(valueAt(source, 'occurred_at_ms'), 0),
    turn_id: nullableId(valueAt(source, 'turn_id'), ID_PATTERNS.turn),
    step_id: nullableId(valueAt(source, 'step_id'), ID_PATTERNS.step),
    tool_call_id: nullableId(valueAt(source, 'tool_call_id'), ID_PATTERNS.tool),
    event_type: eventType,
    payload: sanitizePayload(eventType, valueAt(source, 'payload')),
  });
}

function requiredIds(candidate, runContract, requirements) {
  const expected = {
    turn: requirements.includes('turn') ? runContract.admission.turn_id : null,
    step: requirements.includes('step') ? candidate.step_id : null,
    tool: requirements.includes('tool') ? candidate.tool_call_id : null,
  };
  if (
    candidate.turn_id !== expected.turn
    || (requirements.includes('step') ? candidate.step_id === null : candidate.step_id !== null)
    || (requirements.includes('tool') ? candidate.tool_call_id === null : candidate.tool_call_id !== null)
  ) fail('builder_programming_runtime_event_conflict');
}

function createBuilderProgrammingRuntimeEventJournal(rawOptions) {
  const options = exactObject(rawOptions, ['run_contract']);
  const runContract = sanitizeBuilderProgrammingRuntimeRunContract(
    valueAt(options, 'run_contract'),
  );
  const events = [];
  const byRuntimeRef = new Map();
  const pendingTools = new Map();
  const assistantMessages = new Map();
  let runStarted = false;
  let activeTurn = false;
  let activeStepId = null;
  let expectedStepIndex = 1;
  let turnCompleted = false;
  let terminalStatus = null;

  function assertState(candidate, eventSource) {
    const type = candidate.event_type;
    if (terminalStatus !== null) fail('builder_programming_runtime_event_closed');
    if (!runStarted && type !== 'run_started') fail('builder_programming_runtime_event_conflict');
    if (type === 'run_started') {
      requiredIds(candidate, runContract, []);
      if (
        eventSource !== 'runtime'
        || runStarted
        || candidate.payload.mode !== runContract.admission.mode
      ) {
        fail('builder_programming_runtime_event_conflict');
      }
      return;
    }
    if (type === 'turn_started') {
      requiredIds(candidate, runContract, ['turn']);
      if (
        eventSource !== 'runtime'
        || activeTurn
        || turnCompleted
        || candidate.payload.message_id !== runContract.input.message_id
      ) fail('builder_programming_runtime_event_conflict');
      return;
    }
    if (type === 'step_started') {
      requiredIds(candidate, runContract, ['turn', 'step']);
      if (
        eventSource !== 'runtime'
        || !activeTurn
        || activeStepId !== null
        || candidate.payload.step_index !== expectedStepIndex
      ) fail('builder_programming_runtime_event_conflict');
      return;
    }
    if (type === 'assistant_reasoning_status') {
      if (candidate.step_id === null) requiredIds(candidate, runContract, ['turn']);
      else requiredIds(candidate, runContract, ['turn', 'step']);
      if (
        eventSource !== 'runtime'
        || runContract.runtime_descriptor.capabilities.reasoning_status !== 'bounded_status'
        || !activeTurn
        || (candidate.step_id !== null && candidate.step_id !== activeStepId)
      ) {
        fail('builder_programming_runtime_event_conflict');
      }
      return;
    }
    if (type === 'runtime_activity_status') {
      const requirements = candidate.turn_id === null
        ? []
        : candidate.step_id === null
          ? ['turn']
          : ['turn', 'step'];
      requiredIds(candidate, runContract, requirements);
      if (
        eventSource !== 'runtime'
        || !runStarted
        || (candidate.turn_id !== null && candidate.turn_id !== runContract.admission.turn_id)
        || (candidate.step_id !== null && candidate.step_id !== activeStepId)
      ) fail('builder_programming_runtime_event_conflict');
      return;
    }
    if (type === 'model_usage_recorded' || type === 'model_finish_recorded') {
      requiredIds(candidate, runContract, ['turn', 'step']);
      if (
        eventSource !== 'runtime'
        || !activeTurn
        || candidate.step_id !== activeStepId
      ) fail('builder_programming_runtime_event_conflict');
      return;
    }
    if (
      type === 'assistant_text_delta'
      || type === 'assistant_text_discarded'
      || type === 'assistant_text_completed'
    ) {
      if (eventSource !== 'runtime') fail('builder_programming_runtime_event_conflict');
      requiredIds(candidate, runContract, ['turn', 'step']);
      if (!activeTurn || candidate.step_id !== activeStepId) {
        fail('builder_programming_runtime_event_conflict');
      }
      const current = assistantMessages.get(candidate.payload.message_id) ?? {
        text: '',
        completed: false,
      };
      if (candidate.payload.message_id === runContract.input.message_id) {
        fail('builder_programming_runtime_event_conflict');
      }
      if (current.completed) fail('builder_programming_runtime_event_conflict');
      if (type === 'assistant_text_discarded' && (
        current.text.length === 0
        || candidate.payload.text_digest !== digestText(current.text)
        || candidate.payload.text_bytes !== Buffer.byteLength(current.text, 'utf8')
      )) fail('builder_programming_runtime_event_conflict');
      if (type === 'assistant_text_completed' && (
        current.text.length === 0
        || candidate.payload.text_digest !== digestText(current.text)
        || candidate.payload.text_bytes !== Buffer.byteLength(current.text, 'utf8')
      )) fail('builder_programming_runtime_event_conflict');
      return;
    }
    if (type === 'tool_call_started') {
      requiredIds(candidate, runContract, ['turn', 'step', 'tool']);
      if (
        !activeTurn
        || candidate.step_id !== activeStepId
        || pendingTools.has(candidate.tool_call_id)
      ) fail('builder_programming_runtime_event_conflict');
      if (eventSource === 'runtime' && (
        !runContract.runtime_descriptor.capabilities.native_tool_calls
        || !runContract.admission.allowed_tools.includes(candidate.payload.tool_kind)
      )) fail('builder_programming_runtime_event_conflict');
      const mainToolPolicy = runContract.admission.mode === 'build'
        ? TOOL_KINDS
        : ['read', 'search'];
      if (eventSource === 'main' && !mainToolPolicy.includes(candidate.payload.tool_kind)) {
        fail('builder_programming_runtime_event_conflict');
      }
      return;
    }
    if (
      type === 'tool_call_updated'
      || type === 'tool_call_completed'
      || type === 'tool_call_failed'
      || type === 'file_change_recorded'
      || type === 'check_result_recorded'
    ) {
      requiredIds(candidate, runContract, ['turn', 'step', 'tool']);
      const pending = pendingTools.get(candidate.tool_call_id);
      if (
        !pending
        || pending.event_source !== eventSource
        || candidate.step_id !== pending.step_id
        || candidate.step_id !== activeStepId
      ) {
        fail('builder_programming_runtime_event_conflict');
      }
      if (type === 'tool_call_completed' && candidate.payload.result_kind !== pending.tool_kind) {
        fail('builder_programming_runtime_event_conflict');
      }
      if (
        type === 'file_change_recorded'
        && !['edit', 'write'].includes(pending.tool_kind)
      ) fail('builder_programming_runtime_event_conflict');
      if (type === 'check_result_recorded' && pending.tool_kind !== 'command') {
        fail('builder_programming_runtime_event_conflict');
      }
      return;
    }
    if (type === 'step_completed') {
      requiredIds(candidate, runContract, ['turn', 'step']);
      if (
        !activeTurn
        || candidate.step_id !== activeStepId
        || pendingTools.size > 0
      ) fail('builder_programming_runtime_event_conflict');
      return;
    }
    if (type === 'turn_completed') {
      requiredIds(candidate, runContract, ['turn']);
      if (!activeTurn || activeStepId !== null || pendingTools.size > 0) {
        fail('builder_programming_runtime_event_conflict');
      }
      return;
    }
    if (type === 'run_blocked') {
      requiredIds(candidate, runContract, candidate.turn_id === null ? [] : ['turn']);
      return;
    }
    if (type === 'run_cancelled' || type === 'run_failed') {
      requiredIds(candidate, runContract, candidate.turn_id === null ? [] : ['turn']);
      if (pendingTools.size > 0) fail('builder_programming_runtime_event_conflict');
      return;
    }
    if (type === 'run_completed') {
      requiredIds(candidate, runContract, []);
      const expectedOutcome = { ask: 'answered', plan: 'planned', build: 'built' }[
        runContract.admission.mode
      ];
      const expectedCheckpoint = runContract.admission.mode === 'build'
        ? ['not_applicable', 'created', 'updated']
        : ['not_applicable'];
      if (
        !turnCompleted
        || candidate.payload.outcome !== expectedOutcome
        || !expectedCheckpoint.includes(candidate.payload.checkpoint_status)
      ) fail('builder_programming_runtime_event_conflict');
      return;
    }
    fail();
  }

  function applyState(candidate, eventSource) {
    const type = candidate.event_type;
    if (type === 'run_started') runStarted = true;
    if (type === 'turn_started') activeTurn = true;
    if (type === 'step_started') activeStepId = candidate.step_id;
    if (type === 'assistant_text_delta') {
      const current = assistantMessages.get(candidate.payload.message_id) ?? {
        text: '',
        completed: false,
      };
      current.text += candidate.payload.delta_text;
      assistantMessages.set(candidate.payload.message_id, current);
    }
    if (type === 'assistant_text_discarded') {
      assistantMessages.delete(candidate.payload.message_id);
    }
    if (type === 'assistant_text_completed') {
      const current = assistantMessages.get(candidate.payload.message_id);
      current.completed = true;
    }
    if (type === 'tool_call_started') {
      pendingTools.set(candidate.tool_call_id, {
        step_id: candidate.step_id,
        tool_kind: candidate.payload.tool_kind,
        event_source: eventSource,
      });
    }
    if (type === 'tool_call_completed' || type === 'tool_call_failed') {
      pendingTools.delete(candidate.tool_call_id);
    }
    if (type === 'step_completed') {
      activeStepId = null;
      expectedStepIndex += 1;
    }
    if (type === 'turn_completed') {
      activeTurn = false;
      turnCompleted = true;
    }
    if (['run_cancelled', 'run_failed', 'run_completed'].includes(type)) {
      terminalStatus = type;
    }
  }

  function appendWithSource(rawCandidate, normalizedAtMs, eventSource) {
    const candidate = sanitizeCandidate(rawCandidate, runContract);
    const normalizedAt = safeInteger(normalizedAtMs, 0);
    if (candidate.occurred_at_ms > normalizedAt) fail();
    const candidateDigest = sha256Canonical({ event_source: eventSource, candidate });
    const existing = byRuntimeRef.get(candidate.runtime_event_ref);
    if (existing) {
      if (existing.candidate_digest !== candidateDigest) {
        fail('builder_programming_runtime_event_conflict');
      }
      return existing.event;
    }
    assertState(candidate, eventSource);
    const previous = events.length === 0 ? null : freezeDeep({
      sequence: events[events.length - 1].sequence,
      event_id: events[events.length - 1].event_id,
      event_digest: events[events.length - 1].event_digest,
    });
    const body = freezeDeep({
      event_version: BUILDER_PROGRAMMING_RUNTIME_EVENT_VERSION,
      protocol_version: BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
      sequence: events.length + 1,
      previous_event: previous,
      occurred_at_ms: candidate.occurred_at_ms,
      normalized_at_ms: normalizedAt,
      project_id: runContract.admission.project_id,
      conversation_id: runContract.admission.conversation_id,
      run_id: runContract.admission.run_id,
      runtime_kind: runContract.runtime_descriptor.runtime_kind,
      event_source: eventSource,
      runtime_event_ref: candidate.runtime_event_ref,
      turn_id: candidate.turn_id,
      step_id: candidate.step_id,
      tool_call_id: candidate.tool_call_id,
      event_type: candidate.event_type,
      payload: candidate.payload,
      run_contract_digest: runContract.run_contract_digest,
    });
    const eventDigest = sha256Canonical(body);
    const event = freezeDeep({
      ...body,
      event_id: `builder-programming-runtime-event:${eventDigest.slice('sha256:'.length)}`,
      event_digest: eventDigest,
    });
    applyState(candidate, eventSource);
    events.push(event);
    byRuntimeRef.set(candidate.runtime_event_ref, { candidate_digest: candidateDigest, event });
    return event;
  }

  function append(rawCandidate, normalizedAtMs) {
    return appendWithSource(rawCandidate, normalizedAtMs, 'runtime');
  }

  function appendMainFact(rawCandidate, normalizedAtMs) {
    return appendWithSource(rawCandidate, normalizedAtMs, 'main');
  }

  function snapshot() {
    return freezeDeep({
      run_contract_id: runContract.run_contract_id,
      status: terminalStatus ?? (runStarted ? 'running' : 'not_started'),
      head_sequence: events.length,
      head_event_id: events.length === 0 ? null : events[events.length - 1].event_id,
      events: freezeDeep([...events]),
    });
  }

  return freezeDeep({ append, appendMainFact, snapshot });
}

function sanitizeBuilderProgrammingRuntimeEvent(rawEvent) {
  try {
    const source = exactObject(rawEvent, EVENT_KEYS);
    if (
      valueAt(source, 'event_version') !== BUILDER_PROGRAMMING_RUNTIME_EVENT_VERSION
      || valueAt(source, 'protocol_version') !== BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION
    ) fail();
    const previousValue = valueAt(source, 'previous_event');
    let previous = null;
    if (previousValue !== null) {
      const previousSource = exactObject(previousValue, PREVIOUS_EVENT_KEYS);
      previous = freezeDeep({
        sequence: safeInteger(valueAt(previousSource, 'sequence'), 1, 1_000_000),
        event_id: safePattern(valueAt(previousSource, 'event_id'), ID_PATTERNS.event),
        event_digest: safePattern(valueAt(previousSource, 'event_digest'), DIGEST_PATTERN),
      });
    }
    const eventType = safeEnum(valueAt(source, 'event_type'), EVENT_TYPES);
    const body = freezeDeep({
      event_version: BUILDER_PROGRAMMING_RUNTIME_EVENT_VERSION,
      protocol_version: BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
      sequence: safeInteger(valueAt(source, 'sequence'), 1, 1_000_000),
      previous_event: previous,
      occurred_at_ms: safeInteger(valueAt(source, 'occurred_at_ms'), 0),
      normalized_at_ms: safeInteger(valueAt(source, 'normalized_at_ms'), 0),
      project_id: safePattern(valueAt(source, 'project_id'), ID_PATTERNS.project),
      conversation_id: safePattern(
        valueAt(source, 'conversation_id'),
        ID_PATTERNS.conversation,
      ),
      run_id: safePattern(valueAt(source, 'run_id'), ID_PATTERNS.run),
      runtime_kind: safePattern(valueAt(source, 'runtime_kind'), /^[a-z][a-z0-9_.-]{2,63}$/u),
      event_source: safeEnum(valueAt(source, 'event_source'), ['runtime', 'main']),
      runtime_event_ref: safePattern(
        valueAt(source, 'runtime_event_ref'),
        RUNTIME_EVENT_REF_PATTERN,
      ),
      turn_id: nullableId(valueAt(source, 'turn_id'), ID_PATTERNS.turn),
      step_id: nullableId(valueAt(source, 'step_id'), ID_PATTERNS.step),
      tool_call_id: nullableId(valueAt(source, 'tool_call_id'), ID_PATTERNS.tool),
      event_type: eventType,
      payload: sanitizePayload(eventType, valueAt(source, 'payload')),
      run_contract_digest: safePattern(valueAt(source, 'run_contract_digest'), DIGEST_PATTERN),
    });
    if (body.occurred_at_ms > body.normalized_at_ms) fail();
    const eventDigest = safePattern(valueAt(source, 'event_digest'), DIGEST_PATTERN);
    const eventId = safePattern(valueAt(source, 'event_id'), ID_PATTERNS.event);
    if (
      eventDigest !== sha256Canonical(body)
      || eventId !== `builder-programming-runtime-event:${eventDigest.slice('sha256:'.length)}`
    ) fail();
    return freezeDeep({ ...body, event_id: eventId, event_digest: eventDigest });
  } catch (error) {
    if (error instanceof BuilderProgrammingRuntimeEventError) throw error;
    fail();
  }
}

function admitBuilderProgrammingRuntimeEventContinuation(rawPreviousEvent, rawEvent) {
  const event = sanitizeBuilderProgrammingRuntimeEvent(rawEvent);
  if (rawPreviousEvent === null) {
    if (
      event.sequence !== 1
      || event.previous_event !== null
      || event.event_type !== 'run_started'
    ) fail('builder_programming_runtime_event_conflict');
    return event;
  }
  const previous = sanitizeBuilderProgrammingRuntimeEvent(rawPreviousEvent);
  if (
    event.sequence !== previous.sequence + 1
    || event.previous_event === null
    || event.previous_event.sequence !== previous.sequence
    || event.previous_event.event_id !== previous.event_id
    || event.previous_event.event_digest !== previous.event_digest
    || event.project_id !== previous.project_id
    || event.conversation_id !== previous.conversation_id
    || event.run_id !== previous.run_id
    || event.runtime_kind !== previous.runtime_kind
    || event.run_contract_digest !== previous.run_contract_digest
    || ['run_cancelled', 'run_failed', 'run_completed'].includes(previous.event_type)
  ) fail('builder_programming_runtime_event_conflict');
  return event;
}

module.exports = Object.freeze({
  BUILDER_PROGRAMMING_RUNTIME_EVENT_VERSION,
  BuilderProgrammingRuntimeEventError,
  admitBuilderProgrammingRuntimeEventContinuation,
  createBuilderProgrammingRuntimeEventJournal,
  sanitizeBuilderProgrammingRuntimeEvent,
});
