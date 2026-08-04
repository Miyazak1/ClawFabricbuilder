'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentStepResultContractError,
  createBuilderAgentStepResultReceipt,
  sanitizeBuilderAgentStepResultReceipt,
} = require('./builder-agent-step-result-contract.cjs');
const {
  BUILDER_AGENT_STEP_RESULT_STORE_VERSION,
  BuilderAgentStepResultStoreError,
} = require('./builder-agent-step-result-store.cjs');
const {
  BUILDER_AGENT_STEP_START_STORE_VERSION,
  BuilderAgentStepStartStoreError,
} = require('./builder-agent-step-start-store.cjs');

const BUILDER_AGENT_STEP_RESULT_SERVICE_VERSION =
  'builder-agent-step-result-service.v1';
const BUILDER_AGENT_STEP_RESULT_SERVICE_RESULT_VERSION =
  'builder-agent-step-result-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze([
  'step_result_store',
  'step_start_store',
]);
const RESULT_KEYS = Object.freeze([
  'owner_id',
  'step_id',
  'step_start_receipt_digest',
  'observed_at_ms',
  'result',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_step_result_service_invalid:
    'Builder agent step result could not be verified.',
  builder_agent_step_result_service_conflict:
    'Builder agent step result changed before it could be admitted.',
  builder_agent_step_result_service_unavailable:
    'Builder agent step result service is unavailable.',
});

class BuilderAgentStepResultServiceError extends Error {
  constructor(code = 'builder_agent_step_result_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_step_result_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentStepResultServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentStepResultServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_step_result_service_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_step_result_service_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_step_result_service_invalid');
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_step_result_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_step_result_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeStepId(value) {
  return safePattern(value, STEP_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_step_result_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_step_result_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_step_result_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_step_result_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    step_result_store: safeStore(
      valueAt(rawStores, 'step_result_store'),
      BUILDER_AGENT_STEP_RESULT_STORE_VERSION,
      [
        'record_step_result',
        'read_step_result',
        'read_step_result_for_step_start',
        'read_step_result_for_admission',
        'list_task_step_results',
        'list_run_step_results',
      ],
    ),
    step_start_store: safeStore(
      valueAt(rawStores, 'step_start_store'),
      BUILDER_AGENT_STEP_START_STORE_VERSION,
      [
        'read_step_start',
        'read_step_start_for_admission',
        'list_task_step_starts',
        'list_run_step_starts',
      ],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentStepResultServiceError) {
    return new BuilderAgentStepResultServiceError(error.code);
  }
  if (error instanceof BuilderAgentStepResultContractError) {
    return new BuilderAgentStepResultServiceError(
      'builder_agent_step_result_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentStepResultStoreError
    || error instanceof BuilderAgentStepStartStoreError
  ) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentStepResultServiceError(
        'builder_agent_step_result_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentStepResultServiceError(
        'builder_agent_step_result_service_unavailable',
      );
    }
    return new BuilderAgentStepResultServiceError(
      'builder_agent_step_result_service_invalid',
    );
  }
  return new BuilderAgentStepResultServiceError(
    'builder_agent_step_result_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_step_result_service',
    step_result_store_authority: 'main_owned_agent_step_result_store',
    step_result_receipt_authority: 'main_agent_step_result_receipt_contract_v1',
    step_start_store_authority: 'main_owned_agent_step_start_store',
    step_start_receipt_authority: 'main_agent_step_start_receipt_contract_v1',
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
    recovery_model: 'idempotent_step_result_store_replay',
  });
}

function stepStartFact(stepStartRead) {
  if (stepStartRead.status !== 'ready') fail('builder_agent_step_result_service_conflict');
  const entry = stepStartRead.agent_step_start;
  if (!entry || !entry.step_start_receipt) fail('builder_agent_step_result_service_invalid');
  return entry.step_start_receipt;
}

function stepResultFact(stepResultRead) {
  if (stepResultRead.status !== 'ready') fail('builder_agent_step_result_service_conflict');
  const entry = stepResultRead.agent_step_result;
  if (!entry || !entry.step_result_receipt) fail('builder_agent_step_result_service_invalid');
  return entry.step_result_receipt;
}

function requireRecordedStepStart(stores, ownerId, stepId, expectedDigest) {
  const stepStartRead = stores.step_start_store.read_step_start({
    step_id: stepId,
    owner_id: ownerId,
  });
  const stepStartReceipt = stepStartFact(stepStartRead);
  const admissionStepStartRead = stores.step_start_store.read_step_start_for_admission({
    supervised_action_admission_id: stepStartReceipt.supervised_action_admission_id,
    owner_id: ownerId,
  });
  const taskStepStarts = stores.step_start_store.list_task_step_starts({
    owner_id: stepStartReceipt.owner_id,
    project_id: stepStartReceipt.project_id,
    task_id: stepStartReceipt.task_id,
  });
  const runStepStarts = stores.step_start_store.list_run_step_starts({
    owner_id: stepStartReceipt.owner_id,
    project_id: stepStartReceipt.project_id,
    task_id: stepStartReceipt.task_id,
    run_id: stepStartReceipt.run_id,
  });
  if (
    stepStartReceipt.step_start_receipt_digest !== expectedDigest
    || admissionStepStartRead.status !== 'ready'
    || stepStartFact(admissionStepStartRead).step_start_receipt_digest !== expectedDigest
    || taskStepStarts.status !== 'ready'
    || !taskStepStarts.agent_step_starts.some(
      (entry) => entry.step_start_receipt.step_start_receipt_digest === expectedDigest,
    )
    || runStepStarts.status !== 'ready'
    || !runStepStarts.agent_step_starts.some(
      (entry) => entry.step_start_receipt.step_start_receipt_digest === expectedDigest,
    )
  ) fail('builder_agent_step_result_service_invalid');
  return freezeDeep({
    step_start_receipt: stepStartReceipt,
    step_start_read: stepStartRead,
    admission_step_start_read: admissionStepStartRead,
    task_step_starts: taskStepStarts,
    run_step_starts: runStepStarts,
  });
}

function admitAgentStepResult(stores, rawRequest) {
  exactObject(rawRequest, RESULT_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const stepId = safeStepId(valueAt(rawRequest, 'step_id'));
  const stepStartReceiptDigest = safeDigest(valueAt(rawRequest, 'step_start_receipt_digest'));
  const observedAtMs = safeTimestamp(valueAt(rawRequest, 'observed_at_ms'));
  const stepStartEvidence = requireRecordedStepStart(
    stores,
    ownerId,
    stepId,
    stepStartReceiptDigest,
  );
  const receipt = sanitizeBuilderAgentStepResultReceipt(
    createBuilderAgentStepResultReceipt({
      step_start_receipt: stepStartEvidence.step_start_receipt,
      observed_at_ms: observedAtMs,
      result: valueAt(rawRequest, 'result'),
    }),
  );
  const stepResultWrite = stores.step_result_store.record_step_result({
    step_result_receipt: receipt,
  });
  const stepResultRead = stores.step_result_store.read_step_result({
    step_result_receipt_digest: receipt.step_result_receipt_digest,
    owner_id: receipt.owner_id,
  });
  const stepStartStepResultRead = stores.step_result_store.read_step_result_for_step_start({
    step_start_receipt_digest: receipt.step_start_receipt_digest,
    owner_id: receipt.owner_id,
  });
  const admissionStepResultRead = stores.step_result_store.read_step_result_for_admission({
    supervised_action_admission_id: receipt.supervised_action_admission_id,
    owner_id: receipt.owner_id,
  });
  const taskStepResults = stores.step_result_store.list_task_step_results({
    owner_id: receipt.owner_id,
    project_id: receipt.project_id,
    task_id: receipt.task_id,
  });
  const runStepResults = stores.step_result_store.list_run_step_results({
    owner_id: receipt.owner_id,
    project_id: receipt.project_id,
    task_id: receipt.task_id,
    run_id: receipt.run_id,
  });
  const storedReceipt = stepResultFact(stepResultRead);
  const stepStartStoredReceipt = stepResultFact(stepStartStepResultRead);
  const admissionStoredReceipt = stepResultFact(admissionStepResultRead);
  if (
    storedReceipt.step_result_receipt_digest !== receipt.step_result_receipt_digest
    || stepStartStoredReceipt.step_result_receipt_digest !== receipt.step_result_receipt_digest
    || admissionStoredReceipt.step_result_receipt_digest !== receipt.step_result_receipt_digest
    || taskStepResults.status !== 'ready'
    || !taskStepResults.agent_step_results.some(
      (entry) => entry.step_result_receipt.step_result_receipt_digest === receipt.step_result_receipt_digest,
    )
    || runStepResults.status !== 'ready'
    || !runStepResults.agent_step_results.some(
      (entry) => entry.step_result_receipt.step_result_receipt_digest === receipt.step_result_receipt_digest,
    )
  ) fail('builder_agent_step_result_service_invalid');
  return freezeDeep({
    result_version: BUILDER_AGENT_STEP_RESULT_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_STEP_RESULT_SERVICE_VERSION,
    operation: 'agent_step_result_admitted',
    status: 'ready',
    result_status: storedReceipt.result.status,
    result_summary_code: storedReceipt.result.summary_code,
    step_result_receipt: storedReceipt,
    step_result_store_write: stepResultWrite,
    step_result_read: stepResultRead,
    step_start_step_result_read: stepStartStepResultRead,
    admission_step_result_read: admissionStepResultRead,
    task_step_results: taskStepResults,
    run_step_results: runStepResults,
    step_start_receipt: stepStartEvidence.step_start_receipt,
    step_start_read: stepStartEvidence.step_start_read,
    admission_step_start_read: stepStartEvidence.admission_step_start_read,
    task_step_starts: stepStartEvidence.task_step_starts,
    run_step_starts: stepStartEvidence.run_step_starts,
    operations: {
      step_result_store: stepResultWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentStepResultService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_STEP_RESULT_SERVICE_VERSION,

    admit_agent_step_result(rawRequest) {
      try { return admitAgentStepResult(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_STEP_RESULT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_STEP_RESULT_SERVICE_VERSION,
  BuilderAgentStepResultServiceError,
  createBuilderAgentStepResultService,
});
