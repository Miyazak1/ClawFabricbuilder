'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderAgentStepResultReceipt,
} = require('./builder-agent-step-result-contract.cjs');
const {
  BUILDER_AGENT_STEP_RESULT_STORE_READ_RESULT_VERSION,
} = require('./builder-agent-step-result-store.cjs');
const {
  sanitizeBuilderAgentStepStartReceipt,
} = require('./builder-agent-step-start-contract.cjs');
const {
  BUILDER_AGENT_STEP_START_STORE_READ_RESULT_VERSION,
} = require('./builder-agent-step-start-store.cjs');

const BUILDER_AGENT_STEP_PROGRESS_PROJECTION_VERSION =
  'builder-agent-step-progress-projection.v1';
const MAX_AGENT_STEP_PROGRESS_ITEMS = 128;
const MAX_AGENT_STEP_PROGRESS_INPUTS = 256;
const MAX_AGENT_STEP_PROGRESS_BYTES = 512 * 1_024;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const INPUT_KEYS = Object.freeze([
  'owner_id',
  'project_id',
  'task_id',
  'run_id',
  'step_starts',
  'step_results',
]);
const STEP_START_LIST_KEYS = Object.freeze([
  'result_version',
  'step_start_authority',
  'status',
  'agent_step_starts',
  'truncated',
  'evidence',
]);
const STEP_RESULT_LIST_KEYS = Object.freeze([
  'result_version',
  'step_result_authority',
  'status',
  'agent_step_results',
  'truncated',
  'evidence',
]);
const STEP_START_ENTRY_KEYS = Object.freeze(['step_start_receipt']);
const STEP_RESULT_ENTRY_KEYS = Object.freeze(['step_result_receipt']);
const RESULT_PUBLIC_SUMMARY_BY_CODE = Object.freeze({
  agent_step_completed_without_raw_output:
    'Agent step completed. Details were not kept.',
  agent_step_needs_owner_attention:
    'Agent step needs owner attention.',
  agent_step_failed_without_raw_output:
    'Agent step could not finish. Details were not kept.',
  agent_step_cancelled_without_raw_output:
    'Agent step was stopped. Details were not kept.',
});

class BuilderAgentStepProgressProjectionError extends Error {
  constructor() {
    super('Agent progress is unavailable.');
    this.name = 'BuilderAgentStepProgressProjectionError';
    this.code = 'builder_agent_step_progress_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentStepProgressProjectionError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
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

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function safeStatus(value) {
  if (value !== 'ready' && value !== 'absent') fail();
  return value;
}

function safeBoolean(value) {
  if (typeof value !== 'boolean') fail();
  return value;
}

function denseEntries(value, maxEntries) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maxEntries
  ) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1
    || ownKeys.some((key) => typeof key === 'symbol')
  ) fail();
  const entries = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
    ) fail();
    entries.push(descriptor.value);
  }
  return entries;
}

function startReceiptsFromStoreList(rawList) {
  exactObject(rawList, STEP_START_LIST_KEYS);
  if (
    valueAt(rawList, 'result_version') !== BUILDER_AGENT_STEP_START_STORE_READ_RESULT_VERSION
    || valueAt(rawList, 'step_start_authority') !== 'main_owned_agent_step_start_store'
  ) fail();
  const status = safeStatus(valueAt(rawList, 'status'));
  safeBoolean(valueAt(rawList, 'truncated'));
  const entries = denseEntries(
    valueAt(rawList, 'agent_step_starts'),
    MAX_AGENT_STEP_PROGRESS_INPUTS,
  );
  if ((status === 'absent') !== (entries.length === 0)) fail();
  return entries.map((entry) => {
    exactObject(entry, STEP_START_ENTRY_KEYS);
    return sanitizeBuilderAgentStepStartReceipt(valueAt(entry, 'step_start_receipt'));
  });
}

function resultReceiptsFromStoreList(rawList) {
  exactObject(rawList, STEP_RESULT_LIST_KEYS);
  if (
    valueAt(rawList, 'result_version') !== BUILDER_AGENT_STEP_RESULT_STORE_READ_RESULT_VERSION
    || valueAt(rawList, 'step_result_authority') !== 'main_owned_agent_step_result_store'
  ) fail();
  const status = safeStatus(valueAt(rawList, 'status'));
  safeBoolean(valueAt(rawList, 'truncated'));
  const entries = denseEntries(
    valueAt(rawList, 'agent_step_results'),
    MAX_AGENT_STEP_PROGRESS_INPUTS,
  );
  if ((status === 'absent') !== (entries.length === 0)) fail();
  return entries.map((entry) => {
    exactObject(entry, STEP_RESULT_ENTRY_KEYS);
    return sanitizeBuilderAgentStepResultReceipt(valueAt(entry, 'step_result_receipt'));
  });
}

function assertStartIdentity(receipt, expected) {
  if (
    receipt.owner_id !== expected.owner_id
    || receipt.project_id !== expected.project_id
    || receipt.task_id !== expected.task_id
    || receipt.run_id !== expected.run_id
  ) fail();
}

function assertResultMatchesStart(result, start) {
  if (
    result.step_start_receipt_digest !== start.step_start_receipt_digest
    || result.supervised_action_admission_id !== start.supervised_action_admission_id
    || result.budget_audit_id !== start.budget_audit_id
    || result.assignment_id !== start.assignment_id
    || result.assignment_status_id !== start.assignment_status_id
    || result.lease_id !== start.lease_id
    || result.agent_id !== start.agent_id
    || result.agent_version_id !== start.agent_version_id
    || result.owner_id !== start.owner_id
    || result.project_id !== start.project_id
    || result.conversation_id !== start.conversation_id
    || result.task_id !== start.task_id
    || result.run_id !== start.run_id
    || result.step_id !== start.step_id
    || result.step_index !== start.step_index
    || result.started_at_ms !== start.started_at_ms
  ) fail();
}

function publicResult(result) {
  const summary = RESULT_PUBLIC_SUMMARY_BY_CODE[result.result.summary_code];
  if (summary !== result.result.display_summary) fail();
  return freezeDeep({
    status: result.result.status,
    summary_code: result.result.summary_code,
    display_summary: summary,
  });
}

function itemFromStart(start, result) {
  if (result === null) {
    return {
      item_kind: 'agent_step_progress',
      step_id: start.step_id,
      step_index: start.step_index,
      recorded_state: 'start_recorded',
      result: null,
      summary: {
        status: 'started',
        display_summary: 'Agent step start was recorded.',
      },
    };
  }
  return {
    item_kind: 'agent_step_progress',
    step_id: start.step_id,
    step_index: start.step_index,
    recorded_state: 'result_recorded',
    result: publicResult(result),
    summary: {
      status: result.result.status,
      display_summary: result.result.display_summary,
    },
  };
}

function authority() {
  return freezeDeep({
    agent_step_source: 'main_owned_step_start_and_result_store_projection',
    step_start_receipt: 'verified_not_exposed',
    step_result_receipt: 'verified_not_exposed',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    step_execution: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    raw_output_storage: false,
    raw_context_storage: false,
  });
}

function boundResult(result) {
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (bytes > MAX_AGENT_STEP_PROGRESS_BYTES) fail();
  return freezeDeep(result);
}

function projectBuilderAgentStepProgress(rawInput) {
  try {
    exactObject(rawInput, INPUT_KEYS);
    const expected = freezeDeep({
      owner_id: safeOwnerId(valueAt(rawInput, 'owner_id')),
      project_id: safeProjectId(valueAt(rawInput, 'project_id')),
      task_id: safeTaskId(valueAt(rawInput, 'task_id')),
      run_id: safeRunId(valueAt(rawInput, 'run_id')),
    });
    const starts = startReceiptsFromStoreList(valueAt(rawInput, 'step_starts'));
    const results = resultReceiptsFromStoreList(valueAt(rawInput, 'step_results'));
    const startsByDigest = new Map();
    const startsByStepId = new Map();
    const startsByIndex = new Map();
    for (const start of starts) {
      assertStartIdentity(start, expected);
      if (
        startsByDigest.has(start.step_start_receipt_digest)
        || startsByStepId.has(start.step_id)
        || startsByIndex.has(start.step_index)
      ) fail();
      startsByDigest.set(start.step_start_receipt_digest, start);
      startsByStepId.set(start.step_id, start);
      startsByIndex.set(start.step_index, start);
    }
    const resultsByStartDigest = new Map();
    for (const result of results) {
      const start = startsByDigest.get(result.step_start_receipt_digest);
      if (!start || resultsByStartDigest.has(result.step_start_receipt_digest)) fail();
      assertResultMatchesStart(result, start);
      resultsByStartDigest.set(result.step_start_receipt_digest, result);
    }
    const sortedStarts = [...starts].sort((left, right) => {
      if (left.step_index !== right.step_index) return left.step_index - right.step_index;
      return left.step_id.localeCompare(right.step_id);
    });
    const visibleStarts = sortedStarts.slice(-MAX_AGENT_STEP_PROGRESS_ITEMS);
    const items = visibleStarts.map((start) => itemFromStart(
      start,
      resultsByStartDigest.get(start.step_start_receipt_digest) ?? null,
    ));
    const first = items.at(0) ?? null;
    const last = items.at(-1) ?? null;
    return boundResult({
      projection_version: BUILDER_AGENT_STEP_PROGRESS_PROJECTION_VERSION,
      project_id: expected.project_id,
      task_id: expected.task_id,
      run_id: expected.run_id,
      progress: {
        window: first === null ? null : {
          first_step_index: first.step_index,
          last_step_index: last.step_index,
          has_earlier: sortedStarts.length > visibleStarts.length,
        },
        items,
      },
      authority: authority(),
    });
  } catch (error) {
    if (error instanceof BuilderAgentStepProgressProjectionError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_STEP_PROGRESS_PROJECTION_VERSION,
  MAX_AGENT_STEP_PROGRESS_BYTES,
  MAX_AGENT_STEP_PROGRESS_INPUTS,
  MAX_AGENT_STEP_PROGRESS_ITEMS,
  BuilderAgentStepProgressProjectionError,
  projectBuilderAgentStepProgress,
});
