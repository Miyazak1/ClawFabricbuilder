'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_CONTRACT_VERSION =
  'builder-agent-step-progress-conversation-admission-contract.v1';
const BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_VERSION =
  'builder-agent-step-progress-conversation-admission-record.v1';
const BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_KIND =
  'builder_agent_step_progress_conversation_admission_record';
const STEP_PROGRESS_READ_SERVICE_RESULT_VERSION =
  'builder-agent-step-progress-read-service-result.v1';
const STEP_PROGRESS_READ_SERVICE_VERSION =
  'builder-agent-step-progress-read-service.v1';
const STEP_PROGRESS_PROJECTION_VERSION =
  'builder-agent-step-progress-projection.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const INPUT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'run_status',
  'interrupt_requested',
  'cancel_requested',
  'read_result',
  'step_id',
  'step_index',
  'recorded_state',
  'admitted_at_ms',
]);
const RECORD_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'step_id',
  'step_index',
  'recorded_state',
  'result',
  'summary',
  'admitted_at_ms',
  'source',
  'lifecycle',
  'authority',
  'admission_digest',
]);
const READ_RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'status',
  'projection',
  'read_summary',
  'evidence',
]);
const READ_SUMMARY_KEYS = Object.freeze([
  'step_start_status',
  'step_result_status',
  'step_start_count',
  'step_result_count',
  'truncated',
]);
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'project_id',
  'task_id',
  'run_id',
  'progress',
  'authority',
]);
const PROGRESS_KEYS = Object.freeze(['window', 'items']);
const PROGRESS_ITEM_KEYS = Object.freeze([
  'item_kind',
  'step_id',
  'step_index',
  'recorded_state',
  'result',
  'summary',
]);
const PROJECTION_AUTHORITY_KEYS = Object.freeze([
  'agent_step_source',
  'step_start_receipt',
  'step_result_receipt',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'model_dispatch',
  'tool_dispatch',
  'step_execution',
  'permission_grant_authority',
  'credential_storage',
  'source_access',
  'source_read',
  'source_write',
  'process_run',
  'network_access',
  'revision_authority',
  'review_authority',
  'artifact_authority',
  'raw_output_storage',
  'raw_context_storage',
]);
const READ_EVIDENCE_KEYS = Object.freeze([
  'service_authority',
  'projection_authority',
  'step_start_store_authority',
  'step_result_store_authority',
  'step_start_receipt',
  'step_result_receipt',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'model_dispatch',
  'tool_dispatch',
  'step_execution',
  'permission_grant_authority',
  'credential_storage',
  'source_access',
  'source_read',
  'source_write',
  'process_run',
  'network_access',
  'revision_authority',
  'review_authority',
  'artifact_authority',
  'raw_output_storage',
  'raw_context_storage',
  'recovery_model',
]);
const RESULT_KEYS = Object.freeze(['status', 'summary_code', 'display_summary']);
const SUMMARY_KEYS = Object.freeze(['status', 'display_summary']);
const SOURCE_KEYS = Object.freeze([
  'read_service_result_version',
  'read_service_version',
  'projection_version',
  'read_status',
  'step_start_count',
  'step_result_count',
  'truncated',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'read_service_projection',
  'conversation_admission',
  'task_stream_projection',
  'step_execution',
  'provider_dispatch',
  'model_dispatch',
  'tool_dispatch',
  'source_access',
  'raw_output',
  'project_revision',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'read_service_authority',
  'projection_authority',
  'conversation_binding',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'model_dispatch',
  'tool_dispatch',
  'step_execution',
  'permission_grant_authority',
  'credential_storage',
  'source_access',
  'source_read',
  'source_write',
  'process_run',
  'network_access',
  'revision_authority',
  'review_authority',
  'artifact_authority',
  'raw_output_storage',
  'raw_context_storage',
]);
const RESULT_STATUSES = Object.freeze(['succeeded', 'blocked', 'failed', 'cancelled']);
const RESULT_SUMMARY_CODES = Object.freeze([
  'agent_step_completed_without_raw_output',
  'agent_step_needs_owner_attention',
  'agent_step_failed_without_raw_output',
  'agent_step_cancelled_without_raw_output',
]);
const RESULT_DISPLAY_SUMMARIES = Object.freeze({
  agent_step_completed_without_raw_output:
    'Agent step completed. Details were not kept.',
  agent_step_needs_owner_attention:
    'Agent step needs owner attention.',
  agent_step_failed_without_raw_output:
    'Agent step could not finish. Details were not kept.',
  agent_step_cancelled_without_raw_output:
    'Agent step was stopped. Details were not kept.',
});
const LIFECYCLE = Object.freeze({
  read_service_projection: 'verified_main_owned_read_service_projection',
  conversation_admission: 'ready_for_later_conversation_event',
  task_stream_projection: 'not_recorded_by_contract',
  step_execution: 'not_performed_by_contract',
  provider_dispatch: 'not_performed_by_contract',
  model_dispatch: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  source_access: 'not_performed_by_contract',
  raw_output: 'not_included',
  project_revision: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_agent_step_progress_conversation_admission_contract_v1',
  read_service_authority: 'main_owned_agent_step_progress_read_service',
  projection_authority: 'main_owned_step_start_and_result_store_projection',
  conversation_binding: 'trusted_active_run_required_later',
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
const ERROR_MESSAGES = Object.freeze({
  builder_agent_step_progress_conversation_admission_invalid:
    'Builder agent progress admission could not be verified.',
});

class BuilderAgentStepProgressConversationAdmissionError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_step_progress_conversation_admission_invalid);
    this.name = 'BuilderAgentStepProgressConversationAdmissionError';
    this.code = 'builder_agent_step_progress_conversation_admission_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentStepProgressConversationAdmissionError();
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
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value, projectId) {
  const conversationId = safePattern(value, CONVERSATION_ID_PATTERN);
  if (conversationId.slice('builder-conversation:'.length)
    !== projectId.slice('builder-project:'.length)) fail();
  return conversationId;
}

function safeTurnId(value) {
  return safePattern(value, TURN_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function safeStepId(value) {
  return safePattern(value, STEP_ID_PATTERN);
}

function safeStepIndex(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeBoolean(value) {
  if (typeof value !== 'boolean') fail();
  return value;
}

function assertFixedMap(value, expected, keys) {
  exactObject(value, keys);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (valueAt(value, key) !== expectedValue) fail();
  }
  return freezeDeep({ ...expected });
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 256) fail();
  return value;
}

function safeStatus(value) {
  if (value !== 'ready' && value !== 'absent') fail();
  return value;
}

function safeResult(value) {
  exactObject(value, RESULT_KEYS);
  const status = valueAt(value, 'status');
  const summaryCode = valueAt(value, 'summary_code');
  const displaySummary = valueAt(value, 'display_summary');
  if (
    !RESULT_STATUSES.includes(status)
    || !RESULT_SUMMARY_CODES.includes(summaryCode)
    || RESULT_DISPLAY_SUMMARIES[summaryCode] !== displaySummary
  ) fail();
  if (
    (status === 'succeeded' && summaryCode !== 'agent_step_completed_without_raw_output')
    || (status === 'blocked' && summaryCode !== 'agent_step_needs_owner_attention')
    || (status === 'failed' && summaryCode !== 'agent_step_failed_without_raw_output')
    || (status === 'cancelled' && summaryCode !== 'agent_step_cancelled_without_raw_output')
  ) fail();
  return freezeDeep({ status, summary_code: summaryCode, display_summary: displaySummary });
}

function safeSummary(value, result) {
  exactObject(value, SUMMARY_KEYS);
  const status = valueAt(value, 'status');
  const displaySummary = valueAt(value, 'display_summary');
  if (result === null) {
    if (status !== 'started' || displaySummary !== 'Agent step start was recorded.') fail();
    return freezeDeep({ status, display_summary: displaySummary });
  }
  if (status !== result.status || displaySummary !== result.display_summary) fail();
  return freezeDeep({ status, display_summary: displaySummary });
}

function safeProgressItem(value) {
  exactObject(value, PROGRESS_ITEM_KEYS);
  if (valueAt(value, 'item_kind') !== 'agent_step_progress') fail();
  const recordedState = valueAt(value, 'recorded_state');
  if (recordedState !== 'start_recorded' && recordedState !== 'result_recorded') fail();
  const rawResult = valueAt(value, 'result');
  const result = rawResult === null ? null : safeResult(rawResult);
  if ((recordedState === 'start_recorded') !== (result === null)) fail();
  const item = freezeDeep({
    item_kind: 'agent_step_progress',
    step_id: safeStepId(valueAt(value, 'step_id')),
    step_index: safeStepIndex(valueAt(value, 'step_index')),
    recorded_state: recordedState,
    result,
    summary: safeSummary(valueAt(value, 'summary'), result),
  });
  return item;
}

function denseItems(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > 128
  ) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1
    || ownKeys.some((key) => typeof key === 'symbol')
  ) fail();
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
    ) fail();
    items.push(safeProgressItem(descriptor.value));
  }
  return freezeDeep(items);
}

function safeWindow(value, items) {
  if (value === null) fail();
  exactObject(value, ['first_step_index', 'last_step_index', 'has_earlier']);
  const first = items[0];
  const last = items.at(-1);
  const window = freezeDeep({
    first_step_index: safeStepIndex(valueAt(value, 'first_step_index')),
    last_step_index: safeStepIndex(valueAt(value, 'last_step_index')),
    has_earlier: safeBoolean(valueAt(value, 'has_earlier')),
  });
  if (
    window.first_step_index !== first.step_index
    || window.last_step_index !== last.step_index
  ) fail();
  return window;
}

function safeReadSummary(value, items) {
  exactObject(value, READ_SUMMARY_KEYS);
  const stepStartStatus = safeStatus(valueAt(value, 'step_start_status'));
  const stepResultStatus = safeStatus(valueAt(value, 'step_result_status'));
  const stepStartCount = safeCount(valueAt(value, 'step_start_count'));
  const stepResultCount = safeCount(valueAt(value, 'step_result_count'));
  const truncated = safeBoolean(valueAt(value, 'truncated'));
  if (
    stepStartStatus !== 'ready'
    || stepStartCount < items.length
    || stepResultCount > stepStartCount
    || (stepResultStatus === 'absent' && stepResultCount !== 0)
    || (stepResultStatus === 'ready' && stepResultCount < 1)
  ) fail();
  return freezeDeep({
    step_start_status: stepStartStatus,
    step_result_status: stepResultStatus,
    step_start_count: stepStartCount,
    step_result_count: stepResultCount,
    truncated,
  });
}

function safeReadResult(value, expected) {
  exactObject(value, READ_RESULT_KEYS);
  if (
    valueAt(value, 'result_version') !== STEP_PROGRESS_READ_SERVICE_RESULT_VERSION
    || valueAt(value, 'service_version') !== STEP_PROGRESS_READ_SERVICE_VERSION
    || valueAt(value, 'operation') !== 'agent_step_progress_projected'
    || valueAt(value, 'status') !== 'ready'
  ) fail();
  const projection = valueAt(value, 'projection');
  exactObject(projection, PROJECTION_KEYS);
  if (
    valueAt(projection, 'projection_version') !== STEP_PROGRESS_PROJECTION_VERSION
    || valueAt(projection, 'project_id') !== expected.project_id
    || valueAt(projection, 'task_id') !== expected.task_id
    || valueAt(projection, 'run_id') !== expected.run_id
  ) fail();
  assertFixedMap(valueAt(projection, 'authority'), {
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
  }, PROJECTION_AUTHORITY_KEYS);
  const progress = valueAt(projection, 'progress');
  exactObject(progress, PROGRESS_KEYS);
  const items = denseItems(valueAt(progress, 'items'));
  safeWindow(valueAt(progress, 'window'), items);
  const readSummary = safeReadSummary(valueAt(value, 'read_summary'), items);
  assertFixedMap(valueAt(value, 'evidence'), {
    service_authority: 'main_owned_agent_step_progress_read_service',
    projection_authority: 'main_owned_step_start_and_result_store_projection',
    step_start_store_authority: 'main_owned_agent_step_start_store',
    step_result_store_authority: 'main_owned_agent_step_result_store',
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
    recovery_model: 'read_only_store_projection_replay',
  }, READ_EVIDENCE_KEYS);
  return freezeDeep({ items, read_summary: readSummary });
}

function selectedItem(items, stepId, stepIndex, recordedState) {
  const item = items.find((candidate) => candidate.step_id === stepId) ?? null;
  if (
    item === null
    || item.step_index !== stepIndex
    || item.recorded_state !== recordedState
  ) fail();
  return item;
}

function recordDigestBody(record) {
  const body = { ...record };
  delete body.admission_digest;
  return freezeDeep(body);
}

function createBuilderAgentStepProgressConversationAdmission(rawInput) {
  try {
    exactObject(rawInput, INPUT_KEYS);
    const projectId = safeProjectId(valueAt(rawInput, 'project_id'));
    const context = freezeDeep({
      project_id: projectId,
      conversation_id: safeConversationId(valueAt(rawInput, 'conversation_id'), projectId),
      turn_id: safeTurnId(valueAt(rawInput, 'turn_id')),
      task_id: safeTaskId(valueAt(rawInput, 'task_id')),
      run_id: safeRunId(valueAt(rawInput, 'run_id')),
    });
    if (
      valueAt(rawInput, 'run_status') !== 'running'
      || safeBoolean(valueAt(rawInput, 'interrupt_requested')) !== false
      || safeBoolean(valueAt(rawInput, 'cancel_requested')) !== false
    ) fail();
    const selectedStepId = safeStepId(valueAt(rawInput, 'step_id'));
    const selectedStepIndex = safeStepIndex(valueAt(rawInput, 'step_index'));
    const selectedRecordedState = valueAt(rawInput, 'recorded_state');
    if (
      selectedRecordedState !== 'start_recorded'
      && selectedRecordedState !== 'result_recorded'
    ) fail();
    const readResult = safeReadResult(valueAt(rawInput, 'read_result'), context);
    const progressItem = selectedItem(
      readResult.items,
      selectedStepId,
      selectedStepIndex,
      selectedRecordedState,
    );
    const record = freezeDeep({
      record_version: BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_VERSION,
      record_kind: BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_KIND,
      ...context,
      step_id: progressItem.step_id,
      step_index: progressItem.step_index,
      recorded_state: progressItem.recorded_state,
      result: progressItem.result,
      summary: progressItem.summary,
      admitted_at_ms: safeTimestamp(valueAt(rawInput, 'admitted_at_ms')),
      source: {
        read_service_result_version: STEP_PROGRESS_READ_SERVICE_RESULT_VERSION,
        read_service_version: STEP_PROGRESS_READ_SERVICE_VERSION,
        projection_version: STEP_PROGRESS_PROJECTION_VERSION,
        read_status: 'ready',
        step_start_count: readResult.read_summary.step_start_count,
        step_result_count: readResult.read_summary.step_result_count,
        truncated: readResult.read_summary.truncated,
      },
      lifecycle: { ...LIFECYCLE },
      authority: { ...AUTHORITY },
      admission_digest: null,
    });
    return freezeDeep({
      ...record,
      admission_digest: sha256Canonical(recordDigestBody(record)),
    });
  } catch (error) {
    if (error instanceof BuilderAgentStepProgressConversationAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentStepProgressConversationAdmission(rawRecord) {
  try {
    exactObject(rawRecord, RECORD_KEYS);
    const projectId = safeProjectId(valueAt(rawRecord, 'project_id'));
    const result = valueAt(rawRecord, 'result') === null
      ? null
      : safeResult(valueAt(rawRecord, 'result'));
    const record = freezeDeep({
      record_version: valueAt(rawRecord, 'record_version'),
      record_kind: valueAt(rawRecord, 'record_kind'),
      project_id: projectId,
      conversation_id: safeConversationId(valueAt(rawRecord, 'conversation_id'), projectId),
      turn_id: safeTurnId(valueAt(rawRecord, 'turn_id')),
      task_id: safeTaskId(valueAt(rawRecord, 'task_id')),
      run_id: safeRunId(valueAt(rawRecord, 'run_id')),
      step_id: safeStepId(valueAt(rawRecord, 'step_id')),
      step_index: safeStepIndex(valueAt(rawRecord, 'step_index')),
      recorded_state: valueAt(rawRecord, 'recorded_state'),
      result,
      summary: safeSummary(valueAt(rawRecord, 'summary'), result),
      admitted_at_ms: safeTimestamp(valueAt(rawRecord, 'admitted_at_ms')),
      source: sanitizeSource(valueAt(rawRecord, 'source')),
      lifecycle: assertFixedMap(valueAt(rawRecord, 'lifecycle'), LIFECYCLE, LIFECYCLE_KEYS),
      authority: assertFixedMap(valueAt(rawRecord, 'authority'), AUTHORITY, AUTHORITY_KEYS),
      admission_digest: safeDigest(valueAt(rawRecord, 'admission_digest')),
    });
    if (
      record.record_version
        !== BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_VERSION
      || record.record_kind
        !== BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_KIND
      || (record.recorded_state !== 'start_recorded'
        && record.recorded_state !== 'result_recorded')
      || (record.recorded_state === 'start_recorded') !== (record.result === null)
      || record.admission_digest !== sha256Canonical(recordDigestBody({
        ...record,
        admission_digest: null,
      }))
    ) fail();
    return record;
  } catch (error) {
    if (error instanceof BuilderAgentStepProgressConversationAdmissionError) throw error;
    fail();
  }
}

function sanitizeSource(value) {
  exactObject(value, SOURCE_KEYS);
  const source = freezeDeep({
    read_service_result_version: valueAt(value, 'read_service_result_version'),
    read_service_version: valueAt(value, 'read_service_version'),
    projection_version: valueAt(value, 'projection_version'),
    read_status: valueAt(value, 'read_status'),
    step_start_count: safeCount(valueAt(value, 'step_start_count')),
    step_result_count: safeCount(valueAt(value, 'step_result_count')),
    truncated: safeBoolean(valueAt(value, 'truncated')),
  });
  if (
    source.read_service_result_version !== STEP_PROGRESS_READ_SERVICE_RESULT_VERSION
    || source.read_service_version !== STEP_PROGRESS_READ_SERVICE_VERSION
    || source.projection_version !== STEP_PROGRESS_PROJECTION_VERSION
    || source.read_status !== 'ready'
    || source.step_result_count > source.step_start_count
  ) fail();
  return source;
}

module.exports = Object.freeze({
  BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_CONTRACT_VERSION,
  BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_KIND,
  BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_ADMISSION_RECORD_VERSION,
  BuilderAgentStepProgressConversationAdmissionError,
  createBuilderAgentStepProgressConversationAdmission,
  sanitizeBuilderAgentStepProgressConversationAdmission,
});
