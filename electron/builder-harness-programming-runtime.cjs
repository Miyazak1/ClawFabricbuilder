'use strict';

const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  createBuilderProgrammingRuntimeDescriptor,
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');
const {
  BUILDER_HARNESS_PROCESS_HOST_VERSION,
} = require('./builder-harness-process-host.cjs');
const {
  createBuilderHarnessRuntimeEventNormalizer,
} = require('./builder-harness-runtime-event-normalizer.cjs');
const {
  builderPerformanceTrace,
} = require('./builder-performance-trace.cjs');

const BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION =
  'builder-harness-programming-runtime.v1';
const OPTION_KEYS = Object.freeze([
  'host_factory',
  'workspace_resolver',
  'clock',
  'set_timeout',
  'clear_timeout',
  'supervision_policy',
]);
const SUPERVISION_POLICY_KEYS = Object.freeze(['runtime_idle_timeout_ms']);
const START_KEYS = Object.freeze(['run_contract', 'event_sink']);
const REPAIR_KEYS = Object.freeze(['failure_summary']);
const MANUAL_COMPACT_KEYS = Object.freeze(['session_id', 'source_command_id', 'abort_signal']);
const HANDLE_KEYS = Object.freeze([
  'runtime_version',
  'runtime_kind',
  'run_id',
  'completion',
]);
const CANCEL_REASONS = Object.freeze(['user_requested', 'superseded', 'shutdown']);
const SESSION_ID_PATTERN =
  /^builder-harness-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SOURCE_COMMAND_ID_PATTERN = /^builder-context-compaction-admission:[0-9a-f]{64}$/u;

class BuilderHarnessProgrammingRuntimeError extends Error {
  constructor(code = 'builder_harness_programming_runtime_invalid', causeCode = 'unknown') {
    const selected = [
      'builder_harness_programming_runtime_invalid',
      'builder_harness_programming_runtime_conflict',
      'builder_harness_programming_runtime_closed',
      'builder_harness_programming_runtime_failed',
    ].includes(code) ? code : 'builder_harness_programming_runtime_invalid';
    const messages = {
      builder_harness_programming_runtime_invalid: 'The Harness programming runtime request is invalid.',
      builder_harness_programming_runtime_conflict: 'The Harness programming runtime is already active.',
      builder_harness_programming_runtime_closed: 'The Harness programming runtime is closed.',
      builder_harness_programming_runtime_failed: 'The Harness programming runtime stopped unexpectedly.',
    };
    super(messages[selected]);
    this.name = 'BuilderHarnessProgrammingRuntimeError';
    this.code = selected;
    this.cause_code = typeof causeCode === 'string' && /^[a-z0-9_]{1,96}$/u.test(causeCode)
      ? causeCode
      : 'unknown';
    this.retryable = selected === 'builder_harness_programming_runtime_failed';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code, causeCode) {
  throw new BuilderHarnessProgrammingRuntimeError(code, causeCode);
}

function safeErrorCode(error) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return 'unknown';
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor
    && typeof descriptor.value === 'string'
    && /^[a-z0-9_]{1,96}$/u.test(descriptor.value)
    ? descriptor.value
    : 'unknown';
}

function terminalRuntimeCode(failureClass) {
  if (failureClass === 'cancelled') return 'builder_harness_programming_runtime_cancelled';
  if (failureClass === 'runtime_idle_timeout') {
    return 'builder_harness_programming_runtime_idle_timeout';
  }
  if (failureClass === 'run_limit_reached') {
    return 'builder_harness_programming_run_limit_reached';
  }
  return 'builder_harness_programming_runtime_failed';
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
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function requiredFunction(value, name) {
  const method = valueAt(value, name);
  if (typeof method !== 'function' || utilTypes.isProxy(method)) fail();
  return method;
}

function requiredMethod(value, name) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail();
  }
  return descriptor.value.bind(value);
}

function safePositiveInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeAbortSignal(value) {
  if (value === null) return null;
  if (typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  if (typeof value.aborted !== 'boolean') fail();
  return value;
}

function safeWorkspace(rawValue, runContract) {
  const value = exactObject(rawValue, ['root', 'source_tree_digest']);
  const root = valueAt(value, 'root');
  if (
    typeof root !== 'string'
    || root.length === 0
    || root.includes('\0')
    || !path.isAbsolute(root)
    || path.normalize(root) !== root
    || valueAt(value, 'source_tree_digest') !== runContract.admission.workspace_ref.source_tree_digest
  ) fail();
  return Object.freeze({ root, source_tree_digest: valueAt(value, 'source_tree_digest') });
}

function safeRepairSummary(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > 1_440
    || /[\p{Cf}\p{Bidi_Control}]/u.test(value)
  ) fail();
  return value;
}

function repairToolInstruction(runContract) {
  return runContract.admission.allowed_tools.includes('command')
    ? [
        'The controlled bash tool is available only for an exact current-project test, lint, typecheck, or build script and may pause for one-time user approval.',
        'Builder will rerun the authoritative project check after this repair turn, so using bash during the repair is optional.',
      ].join(' ')
    : 'This Harness profile has no shell or command tool. Do not search for or attempt to call one.';
}

async function measureTraceWindow(windowName, metricName, callback) {
  const windowStarted = builderPerformanceTrace.beginEventLoopWindow(windowName);
  try {
    return await builderPerformanceTrace.measureAsync(metricName, callback);
  } finally {
    if (windowStarted) builderPerformanceTrace.endEventLoopWindow(windowName);
  }
}

function checkedHost(value) {
  if (!isPlainObject(value) || value.host_version !== BUILDER_HARNESS_PROCESS_HOST_VERSION) fail();
  const manualCompact = Reflect.ownKeys(value).includes('manual_compact')
    ? requiredMethod(value, 'manual_compact')
    : null;
  return Object.freeze({
    value,
    start: requiredMethod(value, 'start'),
    prompt: requiredMethod(value, 'prompt'),
    recover_empty_output: request => requiredMethod(value, 'recover_empty_output')(request),
    resume: request => requiredMethod(value, 'resume')(request),
    ...(manualCompact === null ? {} : { manual_compact: request => manualCompact(request) }),
    when_terminated: requiredMethod(value, 'when_terminated'),
    shutdown: requiredMethod(value, 'shutdown'),
    cancel: requiredMethod(value, 'cancel'),
    diagnostics: requiredMethod(value, 'diagnostics'),
  });
}

function createBuilderHarnessProgrammingRuntime(rawOptions) {
  const options = exactObject(rawOptions, OPTION_KEYS);
  const hostFactory = requiredFunction(options, 'host_factory');
  const workspaceResolver = requiredFunction(options, 'workspace_resolver');
  const clock = requiredFunction(options, 'clock');
  const setTimer = requiredFunction(options, 'set_timeout');
  const clearTimer = requiredFunction(options, 'clear_timeout');
  const supervisionPolicy = exactObject(
    valueAt(options, 'supervision_policy'),
    SUPERVISION_POLICY_KEYS,
  );
  const runtimeIdleTimeoutMs = safePositiveInteger(
    valueAt(supervisionPolicy, 'runtime_idle_timeout_ms'),
    100,
    60 * 60 * 1_000,
  );
  const descriptor = createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'deepseek_harness.v1',
    implementation_version: '1.0.0',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'bounded_status',
      native_tool_calls: true,
      steering: 'none',
      cancellation: 'process',
      session_resume: 'runtime_local',
      context_compaction: true,
      parallel_read_tools: true,
    },
  });
  const active = new Map();
  let disposed = false;

  function checkedHandle(rawHandle) {
    const handle = exactObject(rawHandle, HANDLE_KEYS);
    if (
      valueAt(handle, 'runtime_version') !== BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION
      || valueAt(handle, 'runtime_kind') !== descriptor.runtime_kind
      || !(valueAt(handle, 'completion') instanceof Promise)
    ) fail();
    const entry = active.get(valueAt(handle, 'run_id'));
    if (!entry) fail('builder_harness_programming_runtime_closed');
    return entry;
  }

  function supervisedSettlement(entry, taskFactory) {
    return new Promise((resolve) => {
      let settled = false;
      let idleTimer = null;
      let runLimitTimer = null;
      let phase = 'waiting_for_model';
      const clearOwnedTimer = (timer) => {
        if (timer === null) return;
        try { Reflect.apply(clearTimer, undefined, [timer]); } catch { /* result remains fixed */ }
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearOwnedTimer(idleTimer);
        clearOwnedTimer(runLimitTimer);
        idleTimer = null;
        runLimitTimer = null;
        if (entry.supervisor !== null) entry.supervisor = null;
        resolve(value);
      };
      const armIdleTimer = () => {
        clearOwnedTimer(idleTimer);
        idleTimer = Reflect.apply(setTimer, undefined, [
          () => finish(Object.freeze({ status: 'runtime_idle_timeout' })),
          runtimeIdleTimeoutMs,
        ]);
      };
      const noteActivity = (snapshot) => {
        if (settled) return;
        if (snapshot.active_tool_count > 0) {
          phase = 'running_tool';
          clearOwnedTimer(idleTimer);
          idleTimer = null;
          return;
        }
        phase = 'waiting_for_model';
        armIdleTimer();
      };
      entry.supervisor = Object.freeze({
        note_activity: noteActivity,
        phase() { return phase; },
      });
      const elapsed = Math.max(0, Number(Reflect.apply(clock, undefined, [])) - entry.run_started_at_ms);
      const remainingRunMs = entry.run_contract.admission.limits.max_duration_ms - elapsed;
      if (remainingRunMs <= 0) {
        finish(Object.freeze({ status: 'run_limit_reached' }));
        return;
      }
      runLimitTimer = Reflect.apply(setTimer, undefined, [
        () => finish(Object.freeze({ status: 'run_limit_reached' })),
        remainingRunMs,
      ]);
      armIdleTimer();
      let task;
      try {
        task = Reflect.apply(taskFactory, undefined, []);
      } catch (error) {
        finish(Object.freeze({ status: 'host_error', cause_code: safeErrorCode(error) }));
        return;
      }
      void Promise.resolve(task).then(
        finish,
        (error) => finish(Object.freeze({
          status: 'host_error',
          cause_code: safeErrorCode(error),
        })),
      );
    });
  }

  async function stopWithFailureImpl(entry, failureClass, safeMessage, causeCode = 'unknown') {
    if (entry.stop_promise !== null) return entry.stop_promise;
    entry.status = 'stopping';
    entry.stop_promise = (async () => {
      try { await entry.host.cancel(); } catch { /* terminal fact still settles below */ }
      try {
        await entry.normalizer.fail_run({
          failure_class: failureClass,
          safe_message: safeMessage,
        });
      } catch { /* fixed result below */ }
      entry.status = failureClass === 'cancelled' ? 'cancelled' : 'failed';
      return Object.freeze({
        runtime_version: BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
        run_id: entry.run_contract.admission.run_id,
        status: entry.status,
        runtime_code: terminalRuntimeCode(failureClass),
        runtime_cause_code: /^[a-z0-9_]{1,96}$/u.test(causeCode) ? causeCode : 'unknown',
      });
    })();
    return entry.stop_promise;
  }

  async function stopWithFailure(rawEntry, failureClass, safeMessage, causeCode = 'unknown') {
    return await builderPerformanceTrace.measureAsync(
      'main.harness_runtime.stop_with_failure.duration_ms',
      () => stopWithFailureImpl(rawEntry, failureClass, safeMessage, causeCode),
    );
  }

  async function startRun(rawRequest) {
    return await builderPerformanceTrace.measureAsync(
      'main.harness_runtime.start_run.duration_ms',
      () => startRunImpl(rawRequest),
    );
  }

  async function startRunImpl(rawRequest) {
    if (disposed) fail('builder_harness_programming_runtime_closed');
    const request = exactObject(rawRequest, START_KEYS);
    const runContract = sanitizeBuilderProgrammingRuntimeRunContract(valueAt(request, 'run_contract'));
    if (runContract.runtime_descriptor.descriptor_id !== descriptor.descriptor_id) fail();
    const sink = valueAt(request, 'event_sink');
    requiredMethod(sink, 'emit');
    const runId = runContract.admission.run_id;
    if (active.has(runId)) fail('builder_harness_programming_runtime_conflict');
    const workspace = safeWorkspace(
      await Promise.resolve(Reflect.apply(workspaceResolver, undefined, [
        runContract.admission.workspace_ref,
      ])),
      runContract,
    );
    const sessionRunId = runContract.input.resume_session_run_id ?? runId;
    const sessionId = `builder-harness-${sessionRunId.slice('builder-run:'.length)}`;
    let host;
    let runtimeEntry = null;
    let notificationFailure = null;
    const normalizer = createBuilderHarnessRuntimeEventNormalizer({
      run_contract: runContract,
      event_sink: sink,
      session_id: sessionId,
      workspace_root: workspace.root,
      clock,
    });
    const onNotification = async (notification) => {
      try {
        const accepted = await normalizer.handle_notification(notification);
        if (accepted && runtimeEntry !== null && runtimeEntry.supervisor !== null) {
          runtimeEntry.supervisor.note_activity(normalizer.snapshot());
        }
      } catch (error) {
        notificationFailure = error;
        try {
          await normalizer.fail_run({
            failure_class: 'invalid_event',
            safe_message: 'The Harness runtime sent an event that Builder could not verify.',
          });
        } finally {
          if (host) await host.cancel();
        }
        throw error;
      }
    };
    host = checkedHost(await Promise.resolve(Reflect.apply(hostFactory, undefined, [{
      run_contract: runContract,
      workspace,
      session_id: sessionId,
      on_notification: onNotification,
    }])));
    const entry = {
      run_contract: runContract,
      workspace,
      normalizer,
      host,
      session_id: sessionId,
      status: 'starting',
      completion: null,
      stop_promise: null,
      supervisor: null,
      run_started_at_ms: 0,
      notification_failure: () => notificationFailure,
    };
    runtimeEntry = entry;
    active.set(runId, entry);
    try {
      await host.start();
      if (runContract.input.resume_session_run_id !== undefined) {
        await requiredMethod(host, 'resume')({ session_id: sessionId });
      }
      await normalizer.start();
      entry.status = 'running';
      entry.run_started_at_ms = Number(Reflect.apply(clock, undefined, []));
    } catch (error) {
      await stopWithFailure(
        entry,
        'runtime_failure',
        'The Harness coding runtime could not be started.',
      );
      active.delete(runId);
      fail('builder_harness_programming_runtime_failed', safeErrorCode(error));
    }

    entry.completion = (async () => {
      try {
        let promptText = runContract.input.resume_kind === 'interrupted_recovery'
          ? 'Continue the unfinished work from the retained session. Follow the recovery markers in history and verify uncertain side effects before retrying.'
          : runContract.input.text;
        let settlement;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          settlement = await supervisedSettlement(entry, async () => {
            const work = (async () => {
              await measureTraceWindow(
                'harness_runtime_host_prompt',
                'main.harness_runtime.host_prompt.duration_ms',
                () => (attempt === 0 ? host.prompt.bind(host) : requiredMethod(host, 'recover_empty_output'))({
                  session_id: sessionId, text: promptText,
                }),
              );
              return await normalizer.when_settled();
            })();
            const terminated = host.when_terminated().then(() => {
              const error = new Error('The Harness runtime process terminated.');
              error.code = 'builder_harness_process_host_runtime_failed';
              throw error;
            });
            return await Promise.race([work, terminated]);
          });
          const snapshot = normalizer.snapshot();
          const requiredSourceChangeMissing = settlement.status === 'settled'
            && runContract.input.completion_requirement === 'source_change_required'
            && runContract.input.resume_kind !== 'interrupted_recovery'
            && snapshot.successful_mutation_tool_call_count === 0;
          const emptyTokenLimit = settlement.status === 'settled'
            && settlement.reason === 'max-tokens'
            && snapshot.last_assistant_text.trim() === ''
            && snapshot.tool_call_count === 0;
          const incompleteBuild = runContract.admission.mode === 'build'
            && (requiredSourceChangeMissing || emptyTokenLimit);
          if (!incompleteBuild || entry.stop_promise !== null) break;
          if (attempt > 0) {
            return await stopWithFailure(
              entry,
              'provider_failure',
              requiredSourceChangeMissing
                ? 'The approved implementation ended without a successful source change.'
                : 'The model exhausted its output limit without producing text or tool calls.',
              requiredSourceChangeMissing
                ? 'builder_harness_source_change_required'
                : 'builder_harness_empty_output_token_limit',
            );
          }
          // The one recovery turn uses the SDK's non-thinking effort, not another
          // identical reasoning-only request. Model, token cap and tools stay bound.
          await normalizer.prepare_repair({
            failure_summary: requiredSourceChangeMissing
              ? 'The admitted implementation produced no successful source change.'
              : 'Output limit reached before any implementation.',
          });
          if (requiredSourceChangeMissing) {
            builderPerformanceTrace.increment('main.harness_runtime.required_source_change_recovery.count');
            promptText = [
              'The preceding implementation turn ended without a successful Builder write or edit.',
              'This admitted task requires a source change. Search, read, reasoning, and progress narration are not completion evidence.',
              'Continue the same approved implementation now in this existing session. Preserve completed observations and use Builder write or edit to implement the plan.',
              'Do not repeat the request, restate the plan, ask for approval again, or stop after another preparation message.',
              'Builder will run the authoritative checks after your implementation turn.',
              'The complete original requirements remain authoritative:',
              '<original_end_user_request>', runContract.input.text, '</original_end_user_request>',
            ].join('\n');
          } else {
            builderPerformanceTrace.increment('main.harness_runtime.empty_token_limit_recovery.count');
            promptText = [
              'The preceding model turn reached its output token limit without any visible answer or tool call.',
              'No project check has run and no file has changed. Continue the already approved implementation now.',
              'Keep planning concise and begin with a concrete Builder file tool operation. Do not repeat the plan or ask for approval again.',
              'Preserve the complete original requirements below and all admitted tool and permission boundaries.',
              '<original_end_user_request>', runContract.input.text, '</original_end_user_request>',
            ].join('\n');
          }
        }
        if (entry.stop_promise !== null) return await entry.stop_promise;
        if (settlement.status === 'runtime_idle_timeout') {
          return await stopWithFailure(
            entry,
            'runtime_idle_timeout',
            'The Harness coding runtime stopped making progress.',
            'builder_harness_programming_runtime_idle_timeout',
          );
        }
        if (settlement.status === 'run_limit_reached') {
          return await stopWithFailure(
            entry,
            'run_limit_reached',
            'The Harness coding run reached its emergency limit.',
            'builder_harness_programming_run_limit_reached',
          );
        }
        if (settlement.status !== 'settled' || entry.notification_failure() !== null) {
          const notificationError = entry.notification_failure();
          return await stopWithFailure(
            entry,
            settlement.status === 'cancelled' ? 'cancelled' : 'runtime_failure',
            'The Harness coding runtime did not complete.',
            notificationError === null
              ? (settlement.cause_code ?? 'unknown')
              : safeErrorCode(notificationError),
          );
        }
        if (runContract.admission.mode !== 'build') {
          await host.shutdown();
          await normalizer.complete_run({ checkpoint_status: 'not_applicable' });
          entry.status = 'completed';
          active.delete(runId);
          return Object.freeze({
            runtime_version: BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
            run_id: runId,
            status: 'completed',
          });
        }
        entry.status = 'awaiting_reconciliation';
        const normalizerSnapshot = normalizer.snapshot();
        return Object.freeze({
          runtime_version: BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
          run_id: runId,
          status: 'awaiting_reconciliation',
          workspace_root: workspace.root,
          source_tree_digest: workspace.source_tree_digest,
          assistant_text: normalizerSnapshot.last_assistant_text,
          verification_step_id: normalizerSnapshot.verification_step_id,
        });
      } catch (error) {
        return await stopWithFailure(
          entry,
          'runtime_failure',
          'The Harness coding runtime stopped unexpectedly.',
          safeErrorCode(error),
        );
      } finally {
        if (entry.status !== 'awaiting_reconciliation') active.delete(runId);
      }
    })();

    return Object.freeze({
      runtime_version: BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
      runtime_kind: descriptor.runtime_kind,
      run_id: runId,
      completion: entry.completion,
    });
  }

  async function reconcileRun(rawHandle, rawCompletion) {
    return await measureTraceWindow(
      'harness_runtime_reconcile_run',
      'main.harness_runtime.reconcile_run.duration_ms',
      () => reconcileRunImpl(rawHandle, rawCompletion),
    );
  }

  async function reconcileRunImpl(rawHandle, rawCompletion) {
    const entry = checkedHandle(rawHandle);
    if (entry.status !== 'awaiting_reconciliation') fail('builder_harness_programming_runtime_conflict');
    const completion = exactObject(rawCompletion, ['checkpoint_status']);
    const checkpointStatus = valueAt(completion, 'checkpoint_status');
    if (!['not_applicable', 'created', 'updated'].includes(checkpointStatus)) fail();
    await entry.host.shutdown();
    await entry.normalizer.complete_run({ checkpoint_status: checkpointStatus });
    entry.status = 'completed';
    active.delete(entry.run_contract.admission.run_id);
    return Object.freeze({
      runtime_version: BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
      run_id: entry.run_contract.admission.run_id,
      status: 'completed',
      checkpoint_status: checkpointStatus,
    });
  }

  async function repairRun(rawHandle, rawRepair) {
    return await measureTraceWindow(
      'harness_runtime_repair_run',
      'main.harness_runtime.repair_run.duration_ms',
      () => repairRunImpl(rawHandle, rawRepair),
    );
  }

  async function repairRunImpl(rawHandle, rawRepair) {
    const entry = checkedHandle(rawHandle);
    if (entry.status !== 'awaiting_reconciliation') {
      fail('builder_harness_programming_runtime_conflict');
    }
    const repair = exactObject(rawRepair, REPAIR_KEYS);
    const failureSummary = safeRepairSummary(valueAt(repair, 'failure_summary'));
    await entry.normalizer.prepare_repair({ failure_summary: failureSummary });
    entry.status = 'repairing';
    try {
      const settlement = await supervisedSettlement(entry, async () => {
        await builderPerformanceTrace.measureAsync(
          'main.harness_runtime.host_prompt.duration_ms',
          () => entry.host.prompt({
            session_id: entry.session_id,
            text: [
              'The Builder project check failed.',
              `Diagnostic: ${failureSummary}`,
              'Continue from the original end-user request and preserve every constraint in it:',
              '<original_end_user_request>',
              entry.run_contract.input.text,
              '</original_end_user_request>',
              'Inspect the current Builder workspace and repair the implementation failure.',
              'The original request is still authoritative, including any conditional instruction that applies after a failed check. Values explicitly requested only for the first attempt are historical first-attempt requirements, not repair constraints when the current project check proves that they must change.',
              'When the diagnostic is general, inspect the project check definition and the files it references before editing so the repair is grounded in the current workspace.',
              repairToolInstruction(entry.run_contract),
              'Use the diagnostic and current project files to make a focused repair with Builder file tools. Builder will rerun the same main-owned project check after this repair turn.',
              'Do not claim that the check passed. Summarize only the repair you actually completed; the later Builder check result is authoritative.',
              'Do not weaken, delete, bypass, or rewrite tests or verification logic merely to make the check pass. Modify them only when the original end-user request explicitly requires that change.',
              'Keep all user-facing progress and the final summary in the language of the original end-user change request.',
            ].join('\n'),
          }),
        );
        return await entry.normalizer.when_settled();
      });
      if (entry.stop_promise !== null) return await entry.stop_promise;
      if (settlement.status === 'runtime_idle_timeout') {
        const result = await stopWithFailure(
          entry,
          'runtime_idle_timeout',
          'The Harness repair runtime stopped making progress.',
          'builder_harness_programming_runtime_idle_timeout',
        );
        active.delete(entry.run_contract.admission.run_id);
        return result;
      }
      if (settlement.status === 'run_limit_reached') {
        const result = await stopWithFailure(
          entry,
          'run_limit_reached',
          'The Harness coding run reached its emergency limit.',
          'builder_harness_programming_run_limit_reached',
        );
        active.delete(entry.run_contract.admission.run_id);
        return result;
      }
      if (settlement.status !== 'settled' || entry.notification_failure() !== null) {
        const result = await stopWithFailure(
          entry,
          'runtime_failure',
          'The Harness repair run did not complete.',
          entry.notification_failure() === null
            ? (settlement.cause_code ?? 'unknown')
            : safeErrorCode(entry.notification_failure()),
        );
        active.delete(entry.run_contract.admission.run_id);
        return result;
      }
      entry.status = 'awaiting_reconciliation';
      const snapshot = entry.normalizer.snapshot();
      return Object.freeze({
        runtime_version: BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
        run_id: entry.run_contract.admission.run_id,
        status: 'awaiting_reconciliation',
        workspace_root: entry.workspace.root,
        source_tree_digest: entry.workspace.source_tree_digest,
        assistant_text: snapshot.last_assistant_text,
        verification_step_id: snapshot.verification_step_id,
      });
    } catch (error) {
      const result = await stopWithFailure(
        entry,
        'runtime_failure',
        'The Harness repair run stopped unexpectedly.',
        safeErrorCode(error),
      );
      active.delete(entry.run_contract.admission.run_id);
      return result;
    }
  }

  async function cancelRun(rawHandle, rawReason) {
    const entry = checkedHandle(rawHandle);
    if (typeof rawReason !== 'string' || !CANCEL_REASONS.includes(rawReason)) fail();
    await stopWithFailure(
      entry,
      'cancelled',
      'The Harness coding run was cancelled.',
      rawReason,
    );
    active.delete(entry.run_contract.admission.run_id);
    return Object.freeze({
      run_id: entry.run_contract.admission.run_id,
      cancellation_requested: true,
    });
  }

  async function manualCompact(rawRequest) {
    if (disposed) fail('builder_harness_programming_runtime_closed');
    const request = exactObject(rawRequest, MANUAL_COMPACT_KEYS);
    const sessionId = safePattern(valueAt(request, 'session_id'), SESSION_ID_PATTERN);
    const sourceCommandId = safePattern(valueAt(request, 'source_command_id'), SOURCE_COMMAND_ID_PATTERN);
    const abortSignal = safeAbortSignal(valueAt(request, 'abort_signal'));
    if (abortSignal !== null && abortSignal.aborted) fail('builder_harness_programming_runtime_closed');
    const entry = [...active.values()].find((candidate) => candidate.session_id === sessionId);
    if (entry === undefined || entry.host.manual_compact === undefined) {
      fail('builder_harness_programming_runtime_closed');
    }
    return entry.host.manual_compact({
      session_id: sessionId,
      source_command_id: sourceCommandId,
    });
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    await Promise.all([...active.values()].map(async (entry) => {
      try {
        await stopWithFailure(
          entry,
          'cancelled',
          'The Harness coding runtime was shut down.',
          'shutdown',
        );
      } catch { /* disposal still clears local ownership */ }
    }));
    active.clear();
  }

  function diagnostics() {
    return Object.freeze({
      runtime_version: BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
      active_runs: Object.freeze([...active.values()].map((entry) => Object.freeze({
        run_id: entry.run_contract.admission.run_id,
        session_id: entry.session_id,
        status: entry.status,
        host: typeof entry.host?.diagnostics === 'function' ? entry.host.diagnostics() : null,
      }))),
    });
  }

  return Object.freeze({
    runtime_version: BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
    descriptor,
    startRun,
    repairRun,
    reconcileRun,
    manual_compact: manualCompact,
    cancelRun,
    diagnostics,
    dispose,
  });
}

module.exports = Object.freeze({
  BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
  BuilderHarnessProgrammingRuntimeError,
  createBuilderHarnessProgrammingRuntime,
});
