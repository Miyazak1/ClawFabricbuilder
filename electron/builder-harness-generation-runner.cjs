'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
} = require('./builder-harness-runtime-composition.cjs');
const {
  projectBuilderHarnessCandidate,
} = require('./builder-harness-candidate-projector.cjs');
const {
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  sanitizeBuilderProviderConfig,
} = require('./builder-provider-config.cjs');
const { builderPerformanceTrace } = require('./builder-performance-trace.cjs');

const BUILDER_HARNESS_GENERATION_RUNNER_VERSION =
  'builder-harness-generation-runner.v1';
const CREATE_KEYS = Object.freeze(['runtime_composition', 'read_conversation_events']);
const RUN_KEYS = Object.freeze([
  'run_contract', 'source_tree', 'candidate_base_source_tree', 'base_revision_evidence',
  'provider_config', 'credential', 'event_sink',
]);
const RECONCILE_KEYS = Object.freeze(['run_handle', 'checkpoint_status']);
const REPAIR_KEYS = Object.freeze(['run_handle', 'failure_summary']);
const RECOVERABLE_RUNTIME_CODES = Object.freeze(new Set([
  'builder_harness_programming_runtime_failed',
  'builder_harness_programming_runtime_timeout',
  'builder_harness_programming_runtime_idle_timeout',
  'builder_harness_programming_run_limit_reached',
]));

class BuilderHarnessGenerationRunnerError extends Error {
  constructor(
    code = 'builder_harness_generation_runner_invalid',
    runtimeCode = 'unknown',
    runtimeCauseCode = 'unknown',
  ) {
    const selected = [
      'builder_harness_generation_runner_invalid',
      'builder_harness_generation_runner_failed',
      'builder_harness_generation_runner_closed',
    ].includes(code) ? code : 'builder_harness_generation_runner_invalid';
    const messages = {
      builder_harness_generation_runner_invalid: 'The Harness generation request is invalid.',
      builder_harness_generation_runner_failed: 'The Harness coding run did not produce a valid change.',
      builder_harness_generation_runner_closed: 'The Harness generation runner is closed.',
    };
    super(messages[selected]);
    this.name = 'BuilderHarnessGenerationRunnerError';
    this.code = selected;
    this.runtime_code = typeof runtimeCode === 'string' && /^[a-z0-9_]{1,96}$/u.test(runtimeCode)
      ? runtimeCode
      : 'unknown';
    this.runtime_cause_code = typeof runtimeCauseCode === 'string'
      && /^[a-z0-9_]{1,96}$/u.test(runtimeCauseCode)
      ? runtimeCauseCode
      : 'unknown';
    this.retryable = selected === 'builder_harness_generation_runner_failed';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code, runtimeCode, runtimeCauseCode) {
  throw new BuilderHarnessGenerationRunnerError(code, runtimeCode, runtimeCauseCode);
}

function safeErrorProperty(error, key) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return 'unknown';
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && typeof descriptor.value === 'string' ? descriptor.value : 'unknown';
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
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail();
  }
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

function requiredMethod(value, key) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
  return descriptor.value.bind(value);
}

function safeSummary(value) {
  if (typeof value !== 'string') fail();
  const text = value.trim();
  if (text.length === 0) return 'Updated the project files.';
  const firstParagraph = text.split(/\r?\n\s*\r?\n/u)[0].replace(/\s+/gu, ' ').trim();
  const points = Array.from(firstParagraph);
  return points.length <= 400 ? firstParagraph : `${points.slice(0, 397).join('')}...`;
}

function safeAssistantText(value) {
  if (typeof value !== 'string') fail();
  const text = value.trim();
  if (text.length === 0 || Buffer.byteLength(text, 'utf8') > 128 * 1_024) fail();
  return text;
}

async function measureTraceWindow(windowName, metricName, callback) {
  const windowStarted = builderPerformanceTrace.beginEventLoopWindow(windowName);
  try {
    return await builderPerformanceTrace.measureAsync(metricName, callback);
  } finally {
    if (windowStarted) builderPerformanceTrace.endEventLoopWindow(windowName);
  }
}

function recoverySummary(runtimeCode) {
  if (runtimeCode === 'builder_harness_programming_run_limit_reached') {
    return '本轮运行时间较长，已暂停；暂停前完成的改动已保留，可继续检查或重试。';
  }
  if (runtimeCode === 'builder_harness_programming_runtime_idle_timeout') {
    return '编码运行已停止继续推进；停止前完成的改动已保留，可检查后重试。';
  }
  return '编码运行在完成前中断；中断前完成的改动已保留，可检查后重试。';
}

function createBuilderHarnessGenerationRunner(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const composition = valueAt(options, 'runtime_composition');
  if (
    !isPlainObject(composition)
    || composition.composition_version !== BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION
    || !isPlainObject(composition.descriptor)
  ) fail();
  const startRuntime = requiredMethod(composition, 'startRun');
  const repairRuntime = requiredMethod(composition, 'repairRun');
  const reconcileRuntime = requiredMethod(composition, 'reconcileRun');
  const cancelRuntime = requiredMethod(composition, 'cancelRun');
  const pendingRuntimeUserQuestion = requiredMethod(composition, 'pendingUserQuestion');
  const answerRuntimeUserQuestion = requiredMethod(composition, 'answerUserQuestion');
  const disposeRuntime = requiredMethod(composition, 'dispose');
  const readConversationEvents = valueAt(options, 'read_conversation_events');
  if (typeof readConversationEvents !== 'function' || utilTypes.isProxy(readConversationEvents)) fail();
  const active = new Map();
  const cancellationPromises = new WeakMap();
  let disposed = false;

  function cancelHandle(handle, reason) {
    const existing = cancellationPromises.get(handle);
    if (existing !== undefined) return existing;
    const cancellation = Promise.resolve(cancelRuntime(handle, reason));
    cancellationPromises.set(handle, cancellation);
    return cancellation;
  }

  async function run(rawRequest) {
    if (disposed) fail('builder_harness_generation_runner_closed');
    const request = exactObject(rawRequest, RUN_KEYS);
    const runContract = sanitizeBuilderProgrammingRuntimeRunContract(valueAt(request, 'run_contract'));
    if (runContract.runtime_descriptor.descriptor_id !== composition.descriptor.descriptor_id) fail();
    const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(request, 'source_tree'));
    const candidateBaseSourceTree = sanitizeBuilderProjectSourceTree(
      valueAt(request, 'candidate_base_source_tree'),
    );
    const providerConfig = sanitizeBuilderProviderConfig(valueAt(request, 'provider_config'));
    const runId = runContract.admission.run_id;
    if (active.has(runId)) fail();
    let handle;
    try {
      handle = await measureTraceWindow(
        'harness_runner_start_runtime',
        'main.harness_runner.start_runtime.duration_ms',
        () => startRuntime({
          run_contract: runContract,
          source_tree: sourceTree,
          provider_config: providerConfig,
          credential: valueAt(request, 'credential'),
          event_sink: valueAt(request, 'event_sink'),
        }),
      );
      active.set(runId, Object.freeze({
        handle,
        source_tree: sourceTree,
        candidate_base_source_tree: candidateBaseSourceTree,
        base_revision_evidence: valueAt(request, 'base_revision_evidence'),
        turn_id: runContract.admission.turn_id,
      }));
      const completion = await measureTraceWindow(
        'harness_runner_wait_completion',
        'main.harness_runner.wait_completion.duration_ms',
        () => handle.completion,
      );
      const runtimeCode = isPlainObject(completion)
        ? safeErrorProperty(completion, 'runtime_code')
        : 'unknown';
      const recoverableInterruption = isPlainObject(completion)
        && completion.status === 'failed'
        && completion.resulting_source_tree !== null
        && RECOVERABLE_RUNTIME_CODES.has(runtimeCode);
      if (
        !isPlainObject(completion)
        || (completion.status !== 'awaiting_reconciliation' && !recoverableInterruption)
        || completion.resulting_source_tree === null
      ) {
        fail(
          'builder_harness_generation_runner_failed',
          isPlainObject(completion)
            ? safeErrorProperty(completion, 'runtime_code')
            : 'unknown',
          isPlainObject(completion)
            ? safeErrorProperty(completion, 'runtime_cause_code')
            : 'unknown',
        );
      }
      const conversationEvents = await measureTraceWindow(
        'harness_runner_read_conversation_events',
        'main.harness_runner.read_conversation_events.duration_ms',
        () => Promise.resolve(Reflect.apply(
          readConversationEvents,
          undefined,
          [{ run_id: runId }],
        )),
      );
      if (recoverableInterruption) {
        if (completion.resulting_source_tree.source_tree_digest === sourceTree.source_tree_digest) {
          fail(
            'builder_harness_generation_runner_failed',
            runtimeCode,
            safeErrorProperty(completion, 'runtime_cause_code'),
          );
        }
        const candidate = await measureTraceWindow(
          'harness_runner_project_candidate',
          'main.harness_runner.project_candidate.duration_ms',
          async () => projectBuilderHarnessCandidate({
            conversation_events: conversationEvents,
            turn_id: runContract.admission.turn_id,
            run_id: runId,
            base_revision_evidence: valueAt(request, 'base_revision_evidence'),
            base_source_tree: candidateBaseSourceTree,
            resulting_source_tree: completion.resulting_source_tree,
          }),
        );
        const summary = recoverySummary(runtimeCode);
        active.delete(runId);
        return Object.freeze({
          runner_version: BUILDER_HARNESS_GENERATION_RUNNER_VERSION,
          status: 'interrupted_candidate_ready',
          run_id: runId,
          run_handle: handle,
          candidate,
          assistant_text: summary,
          summary,
          verification_step_id: null,
          interruption: Object.freeze({
            runtime_code: runtimeCode,
            runtime_cause_code: safeErrorProperty(completion, 'runtime_cause_code'),
          }),
          credential_retained: false,
        });
      }
      if (completion.resulting_source_tree.source_tree_digest === sourceTree.source_tree_digest) {
        const assistantText = safeAssistantText(completion.assistant_text);
        return Object.freeze({
          runner_version: BUILDER_HARNESS_GENERATION_RUNNER_VERSION,
          status: 'response_ready',
          run_id: runId,
          run_handle: handle,
          candidate: null,
          assistant_text: assistantText,
          summary: safeSummary(assistantText),
          verification_step_id: completion.verification_step_id,
          credential_retained: false,
        });
      }
      const candidate = await measureTraceWindow(
        'harness_runner_project_candidate',
        'main.harness_runner.project_candidate.duration_ms',
        async () => projectBuilderHarnessCandidate({
          conversation_events: conversationEvents,
          turn_id: runContract.admission.turn_id,
          run_id: runId,
          base_revision_evidence: valueAt(request, 'base_revision_evidence'),
          base_source_tree: candidateBaseSourceTree,
          resulting_source_tree: completion.resulting_source_tree,
        }),
      );
      return Object.freeze({
        runner_version: BUILDER_HARNESS_GENERATION_RUNNER_VERSION,
        status: 'candidate_ready',
        run_id: runId,
        run_handle: handle,
        candidate,
        assistant_text: completion.assistant_text,
        summary: safeSummary(completion.assistant_text),
        verification_step_id: completion.verification_step_id,
        credential_retained: false,
      });
    } catch (error) {
      if (handle !== undefined) {
        try { await cancelHandle(handle, 'superseded'); } catch { /* stable error below */ }
      }
      active.delete(runId);
      if (error instanceof BuilderHarnessGenerationRunnerError) throw error;
      fail(
        'builder_harness_generation_runner_failed',
        safeErrorProperty(error, 'code'),
        safeErrorProperty(error, 'cause_code'),
      );
    }
  }

  async function reconcile(rawRequest) {
    const request = exactObject(rawRequest, RECONCILE_KEYS);
    const handle = valueAt(request, 'run_handle');
    const runId = valueAt(handle, 'run_id');
    if (active.get(runId)?.handle !== handle) fail('builder_harness_generation_runner_closed');
    const checkpointStatus = valueAt(request, 'checkpoint_status');
    if (!['not_applicable', 'created', 'updated'].includes(checkpointStatus)) fail();
    try {
      return await measureTraceWindow(
        'harness_runner_reconcile_runtime',
        'main.harness_runner.reconcile_runtime.duration_ms',
        () => reconcileRuntime(handle, { checkpoint_status: checkpointStatus }),
      );
    } finally {
      active.delete(runId);
    }
  }

  async function cancel(rawHandle, rawReason) {
    const runId = valueAt(rawHandle, 'run_id');
    if (active.get(runId)?.handle !== rawHandle) {
      return Object.freeze({ run_id: runId, cancelled: false });
    }
    try { return await cancelHandle(rawHandle, rawReason); }
    finally { active.delete(runId); }
  }

  async function cancelRunId(rawRunId, rawReason) {
    if (typeof rawRunId !== 'string') fail();
    const entry = active.get(rawRunId);
    if (entry === undefined) {
      return Object.freeze({ run_id: rawRunId, cancelled: false });
    }
    return cancel(entry.handle, rawReason);
  }

  function pendingUserQuestion(rawRunId) {
    if (typeof rawRunId !== 'string' || !active.has(rawRunId)) return null;
    return pendingRuntimeUserQuestion(rawRunId);
  }

  function answerUserQuestion(rawRunId, rawMessage) {
    if (typeof rawRunId !== 'string' || typeof rawMessage !== 'string' || !active.has(rawRunId)) {
      return false;
    }
    return answerRuntimeUserQuestion({ run_id: rawRunId, message: rawMessage });
  }

  async function repair(rawRequest) {
    const request = exactObject(rawRequest, REPAIR_KEYS);
    const handle = valueAt(request, 'run_handle');
    const runId = valueAt(handle, 'run_id');
    const entry = active.get(runId);
    if (entry === undefined || entry.handle !== handle) {
      fail('builder_harness_generation_runner_closed');
    }
    const completion = await measureTraceWindow(
      'harness_runner_repair_runtime',
      'main.harness_runner.repair_runtime.duration_ms',
      () => repairRuntime(handle, {
        failure_summary: valueAt(request, 'failure_summary'),
      }),
    );
    if (
      !isPlainObject(completion)
      || completion.status !== 'awaiting_reconciliation'
      || completion.resulting_source_tree === null
    ) {
      active.delete(runId);
      fail(
        'builder_harness_generation_runner_failed',
        isPlainObject(completion)
          ? safeErrorProperty(completion, 'runtime_code')
          : 'unknown',
        isPlainObject(completion)
          ? safeErrorProperty(completion, 'runtime_cause_code')
          : 'unknown',
      );
    }
    const conversationEvents = await measureTraceWindow(
      'harness_runner_read_conversation_events',
      'main.harness_runner.read_conversation_events.duration_ms',
      () => Promise.resolve(Reflect.apply(
        readConversationEvents,
        undefined,
        [{ run_id: runId }],
      )),
    );
    const candidate = await measureTraceWindow(
      'harness_runner_project_candidate',
      'main.harness_runner.project_candidate.duration_ms',
      async () => projectBuilderHarnessCandidate({
        conversation_events: conversationEvents,
        turn_id: entry.turn_id,
        run_id: runId,
        base_revision_evidence: entry.base_revision_evidence,
        base_source_tree: entry.candidate_base_source_tree,
        resulting_source_tree: completion.resulting_source_tree,
      }),
    );
    return Object.freeze({
      runner_version: BUILDER_HARNESS_GENERATION_RUNNER_VERSION,
      status: 'candidate_ready',
      run_id: runId,
      run_handle: handle,
      candidate,
      assistant_text: completion.assistant_text,
      summary: safeSummary(completion.assistant_text),
      verification_step_id: completion.verification_step_id,
      credential_retained: false,
    });
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    await disposeRuntime();
    active.clear();
  }

  return Object.freeze({
    runner_version: BUILDER_HARNESS_GENERATION_RUNNER_VERSION,
    descriptor: composition.descriptor,
    run,
    repair,
    reconcile,
    cancel,
    cancel_run_id: cancelRunId,
    pending_user_question: pendingUserQuestion,
    answer_user_question: answerUserQuestion,
    dispose,
  });
}

module.exports = Object.freeze({
  BUILDER_HARNESS_GENERATION_RUNNER_VERSION,
  BuilderHarnessGenerationRunnerError,
  createBuilderHarnessGenerationRunner,
});
