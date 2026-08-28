'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  createBuilderProjectUnderstandingSnapshot,
} = require('./builder-project-understanding.cjs');
const {
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  builderPerformanceTrace,
} = require('./builder-performance-trace.cjs');

const BUILDER_CONTROLLED_COMMAND_APPROVAL_SERVICE_VERSION =
  'builder-controlled-command-approval-service.v1';
const BUILDER_CONTROLLED_COMMAND_APPROVAL_REQUEST_VERSION =
  'builder-controlled-command-approval-request.v1';
const BUILDER_CONTROLLED_COMMAND_EXECUTION_APPROVAL_VERSION =
  'builder-controlled-command-execution-approval.v1';
const APPROVAL_LIFETIME_MS = 5 * 60 * 1_000;
const CREATE_KEYS = Object.freeze(['now_ms', 'on_approval_requested']);
const REQUEST_KEYS = Object.freeze(['run_contract', 'source_tree', 'command', 'description']);
const DECISION_KEYS = Object.freeze(['run_id', 'approval_request_id', 'decision']);
const CONSUME_KEYS = Object.freeze([
  'execution_approval', 'run_contract', 'source_tree', 'command_profile_id',
]);
const DECISIONS = Object.freeze(['allow_once', 'deny']);
const REQUEST_ID_PATTERN = /^builder-controlled-command-approval-request:[0-9a-f-]{36}$/u;
const SAFE_DESCRIPTION_PATTERN = /^[^\0\r\n]{1,240}$/u;

class BuilderControlledCommandApprovalServiceError extends Error {
  constructor(code = 'builder_controlled_command_approval_invalid') {
    const selected = [
      'builder_controlled_command_approval_invalid',
      'builder_controlled_command_approval_forbidden',
      'builder_controlled_command_approval_conflict',
      'builder_controlled_command_approval_expired',
      'builder_controlled_command_approval_denied',
      'builder_controlled_command_approval_consumed',
    ].includes(code) ? code : 'builder_controlled_command_approval_invalid';
    const messages = {
      builder_controlled_command_approval_invalid: 'The project command approval could not be verified.',
      builder_controlled_command_approval_forbidden: 'This project command is not available in the current mode.',
      builder_controlled_command_approval_conflict: 'Another project command is waiting for approval.',
      builder_controlled_command_approval_expired: 'The project command approval expired.',
      builder_controlled_command_approval_denied: 'The project command was denied.',
      builder_controlled_command_approval_consumed: 'The project command approval was already used.',
    };
    super(messages[selected]);
    this.name = 'BuilderControlledCommandApprovalServiceError';
    this.code = selected;
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderControlledCommandApprovalServiceError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function safeNow(nowMs) {
  const value = Number(Reflect.apply(nowMs, undefined, []));
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeText(value, maximumBytes, pattern = null) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || (pattern !== null && !pattern.test(value))
  ) fail();
  return value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function projectUnderstanding(runContract, sourceTree, nowMs) {
  return createBuilderProjectUnderstandingSnapshot({
    project_id: runContract.admission.project_id,
    root_digest: runContract.admission.workspace_ref.source_tree_digest,
    source_tree: sourceTree,
    previous_successful_check_runs: [],
    updated_at_ms: nowMs,
  });
}

function selectedProfile(understanding, command) {
  const profile = understanding.command_profiles.find((entry) => entry.command_display === command);
  if (profile === undefined) fail('builder_controlled_command_approval_forbidden');
  return profile;
}

function sameRun(left, right) {
  return left.project_id === right.project_id
    && left.conversation_id === right.conversation_id
    && left.turn_id === right.turn_id
    && left.task_id === right.task_id
    && left.run_id === right.run_id;
}

function createBuilderControlledCommandApprovalService(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const nowMs = options.now_ms.value;
  const onApprovalRequested = options.on_approval_requested.value;
  if (
    typeof nowMs !== 'function'
    || utilTypes.isProxy(nowMs)
    || typeof onApprovalRequested !== 'function'
    || utilTypes.isProxy(onApprovalRequested)
  ) fail();

  const pendingByRun = new Map();
  const trustedApprovals = new WeakSet();
  const consumedApprovals = new WeakSet();
  const approvedProfiles = new WeakMap();

  function publicRequest(pending) {
    return freezeDeep({
      request_version: BUILDER_CONTROLLED_COMMAND_APPROVAL_REQUEST_VERSION,
      approval_request_id: pending.approval_request_id,
      project_id: pending.run.project_id,
      conversation_id: pending.run.conversation_id,
      turn_id: pending.run.turn_id,
      task_id: pending.run.task_id,
      run_id: pending.run.run_id,
      command_profile_id: pending.profile.command_profile_id,
      command_kind: pending.profile.command_kind,
      command_display: pending.profile.command_display,
      description: pending.description,
      source_tree_digest: pending.source_tree_digest,
      requested_at_ms: pending.requested_at_ms,
      expires_at_ms: pending.expires_at_ms,
      risk_notice: 'This project script may modify files or use the network.',
      decisions: [...DECISIONS],
    });
  }

  async function requestApproval(rawRequest) {
    return await builderPerformanceTrace.measureAsync(
      'main.command_approval.request.duration_ms',
      () => requestApprovalImpl(rawRequest),
    );
  }

  async function requestApprovalImpl(rawRequest) {
    const request = exactObject(rawRequest, REQUEST_KEYS);
    const runContract = sanitizeBuilderProgrammingRuntimeRunContract(request.run_contract.value);
    if (
      runContract.admission.mode !== 'build'
      || !runContract.admission.allowed_tools.includes('command')
    ) fail('builder_controlled_command_approval_forbidden');
    if (pendingByRun.has(runContract.admission.run_id)) {
      fail('builder_controlled_command_approval_conflict');
    }
    const prepared = builderPerformanceTrace.measureSync(
      'main.command_approval.prepare.duration_ms',
      () => {
        const sourceTree = sanitizeBuilderProjectSourceTree(request.source_tree.value);
        const command = safeText(request.command.value, 512);
        const description = safeText(request.description.value, 1_024, SAFE_DESCRIPTION_PATTERN);
        const requestedAtMs = safeNow(nowMs);
        const understanding = projectUnderstanding(runContract, sourceTree, requestedAtMs);
        const profile = selectedProfile(understanding, command);
        const approvalRequestId = `builder-controlled-command-approval-request:${nodeCrypto.randomUUID()}`;
        let resolveDecision;
        let rejectDecision;
        const decisionPromise = new Promise((resolve, reject) => {
          resolveDecision = resolve;
          rejectDecision = reject;
        });
        const pending = {
          approval_request_id: approvalRequestId,
          run: runContract.admission,
          profile,
          description,
          source_tree_digest: sourceTree.source_tree_digest,
          requested_at_ms: requestedAtMs,
          expires_at_ms: requestedAtMs + APPROVAL_LIFETIME_MS,
          resolve: resolveDecision,
          reject: rejectDecision,
        };
        return Object.freeze({ pending, decision_promise: decisionPromise });
      },
    );
    const pending = prepared.pending;
    pendingByRun.set(runContract.admission.run_id, pending);
    try {
      await Promise.resolve(Reflect.apply(onApprovalRequested, undefined, [publicRequest(pending)]));
      return await builderPerformanceTrace.measureAsync(
        'main.command_approval.wait_decision.duration_ms',
        () => prepared.decision_promise,
      );
    } catch (error) {
      if (pendingByRun.get(runContract.admission.run_id) === pending) {
        pendingByRun.delete(runContract.admission.run_id);
      }
      throw error;
    }
  }

  function decide(rawDecision) {
    return builderPerformanceTrace.measureSync(
      'main.command_approval.decide.duration_ms',
      () => decideImpl(rawDecision),
    );
  }

  function decideImpl(rawDecision) {
    const decision = exactObject(rawDecision, DECISION_KEYS);
    const runId = safeText(decision.run_id.value, 128);
    const requestId = safeText(decision.approval_request_id.value, 128);
    if (!REQUEST_ID_PATTERN.test(requestId) || !DECISIONS.includes(decision.decision.value)) fail();
    const pending = pendingByRun.get(runId);
    if (pending === undefined || pending.approval_request_id !== requestId) return false;
    pendingByRun.delete(runId);
    const decidedAtMs = safeNow(nowMs);
    if (decidedAtMs >= pending.expires_at_ms) {
      pending.reject(new BuilderControlledCommandApprovalServiceError(
        'builder_controlled_command_approval_expired',
      ));
      return true;
    }
    if (decision.decision.value === 'deny') {
      pending.reject(new BuilderControlledCommandApprovalServiceError(
        'builder_controlled_command_approval_denied',
      ));
      return true;
    }
    const approval = freezeDeep({
      approval_version: BUILDER_CONTROLLED_COMMAND_EXECUTION_APPROVAL_VERSION,
      approval_request_id: pending.approval_request_id,
      project_id: pending.run.project_id,
      conversation_id: pending.run.conversation_id,
      turn_id: pending.run.turn_id,
      task_id: pending.run.task_id,
      run_id: pending.run.run_id,
      command_profile_id: pending.profile.command_profile_id,
      command_kind: pending.profile.command_kind,
      command_display: pending.profile.command_display,
      script_digest: pending.profile.script_digest,
      source_tree_digest: pending.source_tree_digest,
      approved_at_ms: decidedAtMs,
      expires_at_ms: pending.expires_at_ms,
      status: 'approved_once',
      authority: 'main_owned_structured_user_decision',
    });
    trustedApprovals.add(approval);
    approvedProfiles.set(approval, pending.profile);
    pending.resolve(approval);
    return true;
  }

  function consume(rawConsume) {
    return builderPerformanceTrace.measureSync(
      'main.command_approval.consume.duration_ms',
      () => consumeImpl(rawConsume),
    );
  }

  function consumeImpl(rawConsume) {
    const consume = exactObject(rawConsume, CONSUME_KEYS);
    const approval = consume.execution_approval.value;
    if (!isPlainObject(approval) || !trustedApprovals.has(approval)) fail();
    if (consumedApprovals.has(approval)) fail('builder_controlled_command_approval_consumed');
    const runContract = sanitizeBuilderProgrammingRuntimeRunContract(consume.run_contract.value);
    const sourceTree = sanitizeBuilderProjectSourceTree(consume.source_tree.value);
    const commandProfileId = safeText(consume.command_profile_id.value, 128);
    const consumedAtMs = safeNow(nowMs);
    const profile = approvedProfiles.get(approval);
    if (
      runContract.admission.mode !== 'build'
      || !runContract.admission.allowed_tools.includes('command')
      || profile === undefined
      || consumedAtMs >= approval.expires_at_ms
      || !sameRun(approval, runContract.admission)
      || approval.command_profile_id !== profile.command_profile_id
      || commandProfileId !== profile.command_profile_id
      || approval.command_kind !== profile.command_kind
      || approval.command_display !== profile.command_display
      || approval.script_digest !== profile.script_digest
      || approval.source_tree_digest !== sourceTree.source_tree_digest
    ) fail('builder_controlled_command_approval_expired');
    consumedApprovals.add(approval);
    return profile;
  }

  function cancelRun(rawRunId) {
    const runId = safeText(rawRunId, 128);
    const pending = pendingByRun.get(runId);
    if (pending === undefined) return false;
    pendingByRun.delete(runId);
    pending.reject(new BuilderControlledCommandApprovalServiceError(
      'builder_controlled_command_approval_denied',
    ));
    return true;
  }

  return freezeDeep({
    service_version: BUILDER_CONTROLLED_COMMAND_APPROVAL_SERVICE_VERSION,
    request_approval: requestApproval,
    decide,
    consume,
    pending_for_run(rawRunId) {
      const runId = safeText(rawRunId, 128);
      const pending = pendingByRun.get(runId);
      return pending === undefined ? null : publicRequest(pending);
    },
    cancel_run: cancelRun,
  });
}

module.exports = freezeDeep({
  APPROVAL_LIFETIME_MS,
  BUILDER_CONTROLLED_COMMAND_APPROVAL_REQUEST_VERSION,
  BUILDER_CONTROLLED_COMMAND_APPROVAL_SERVICE_VERSION,
  BUILDER_CONTROLLED_COMMAND_EXECUTION_APPROVAL_VERSION,
  BuilderControlledCommandApprovalServiceError,
  createBuilderControlledCommandApprovalService,
});
