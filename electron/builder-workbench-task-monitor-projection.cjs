'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const PROJECTION_VERSION = 'builder-workbench-task-monitor.v2';
const AGENT_ID_PATTERN = /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ADDRESS_ID_PATTERN = /^builder-task-address:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANCELLABLE_TASK_STATES = Object.freeze(new Set([
  'working', 'waiting_permission', 'waiting_user_input', 'waiting_resource',
]));

class BuilderWorkbenchTaskMonitorProjectionError extends Error {
  constructor() {
    super('Builder Workbench task monitor could not be projected.');
    this.name = 'BuilderWorkbenchTaskMonitorProjectionError';
    this.code = 'builder_workbench_task_monitor_projection_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderWorkbenchTaskMonitorProjectionError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function stableMethod(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  let cursor = value;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function safeSummary(item) {
  const message = item?.assistant_message?.text;
  if (typeof message === 'string' && message.trim().length > 0) return message.trim().slice(0, 2_048);
  const candidate = item?.candidate;
  if (typeof candidate?.summary === 'string' && candidate.summary.trim().length > 0) {
    return candidate.summary.trim().slice(0, 2_048);
  }
  if (item?.terminal_status === 'cancelled') return 'The task was stopped.';
  if (item?.terminal_status === 'interrupted') return 'The task was interrupted and can be continued.';
  if (item?.terminal_status === 'failed') return 'The task needs attention before it can continue.';
  if (item?.result_kind === 'plan') return 'A plan is ready for review.';
  if (item?.result_kind === 'candidate') return 'A draft is ready for review.';
  return 'The task completed its latest step.';
}

function resultId(taskAddressId, runId) {
  return `builder-task-result:${nodeCrypto.createHash('sha256')
    .update(`${taskAddressId}:${runId}`, 'utf8')
    .digest('hex')}`;
}

function publicAttention(value) {
  const attention = value !== null
    && typeof value === 'object'
    && Object.hasOwn(value, 'attention')
    ? value.attention
    : value;
  if (attention === null || attention === undefined || attention.state === 'ready') return null;
  const presentations = {
    waiting_permission: ['Permission required', 'This task needs your permission before it can continue.', 'Review permission'],
    waiting_user_input: ['Answer required', 'This task is waiting for your answer before it can continue.', 'Answer task'],
    waiting_resource: ['Project busy', 'Another task is using this project. Review the task before continuing.', 'Review conflict'],
    paused: ['Paused', 'This task is paused and can be resumed from its task conversation.', 'Open paused task'],
  };
  const presentation = presentations[attention?.state];
  if (presentation === undefined) fail();
  return freezeDeep({
    attention_version: 'builder-workbench-task-attention-summary.v1',
    state: attention.state,
    label: presentation[0],
    detail: presentation[1],
    action_label: presentation[2],
  });
}

function deriveTaskState(task, stream, attentionValue) {
  const attention = publicAttention(attentionValue);
  if (attention !== null) {
    return freezeDeep({
      group: 'attention',
      state: attention.state,
      status_label: attention.label,
      latest_activity_at_ms: Math.max(
        task.updated_at_ms,
        attentionValue?.attention?.updated_at_ms ?? attentionValue?.updated_at_ms ?? 0,
      ),
      latest_result: null,
      attention,
    });
  }
  if (
    stream === null
    || typeof stream !== 'object'
    || stream.stream_version !== 'builder-task-stream-read-result.v1'
    || stream.project_id !== task.project_id
    || stream.conversation === null
    || stream.conversation.conversation_id !== task.conversation_id
    || !Array.isArray(stream.conversation.items)
  ) {
    return freezeDeep({
      group: 'active',
      state: 'draft',
      status_label: 'Ready to start',
      latest_activity_at_ms: task.updated_at_ms,
      latest_result: null,
      attention: null,
    });
  }

  const items = stream.conversation.items;
  const activeRuns = new Set();
  let latestCompletion = null;
  const candidateReviews = new Map();
  const planReviews = new Map();
  for (const item of items) {
    if (item?.item_kind === 'run_started' && typeof item.run_id === 'string') activeRuns.add(item.run_id);
    if (item?.item_kind === 'run_completed' && typeof item.run_id === 'string') {
      activeRuns.delete(item.run_id);
      if (latestCompletion === null || item.sequence > latestCompletion.sequence) latestCompletion = item;
    }
    if (item?.item_kind === 'candidate_reviewed' && typeof item.run_id === 'string') {
      candidateReviews.set(item.run_id, item.decision);
    }
    if (item?.item_kind === 'plan_reviewed' && typeof item.run_id === 'string') {
      planReviews.set(item.run_id, item.decision);
    }
  }
  const latestActivityAtMs = stream.conversation.created_at_ms + stream.conversation.head_sequence;
  if (activeRuns.size > 0) {
    return freezeDeep({
      group: 'active',
      state: 'working',
      status_label: 'Working',
      latest_activity_at_ms: latestActivityAtMs,
      latest_result: null,
      attention: null,
    });
  }
  if (latestCompletion === null) {
    return freezeDeep({
      group: 'active',
      state: items.length === 0 ? 'draft' : 'ready',
      status_label: items.length === 0 ? 'Ready to start' : 'Ready',
      latest_activity_at_ms: latestActivityAtMs,
      latest_result: null,
      attention: null,
    });
  }

  const planReview = planReviews.get(latestCompletion.run_id) ?? null;
  const candidateReview = candidateReviews.get(latestCompletion.run_id) ?? null;
  let group = 'recent';
  let state = 'ready';
  let statusLabel = 'Ready';
  if (latestCompletion.terminal_status === 'failed') {
    group = 'attention';
    state = 'failed';
    statusLabel = 'Needs attention';
  } else if (latestCompletion.terminal_status === 'interrupted') {
    group = 'attention';
    state = 'interrupted';
    statusLabel = 'Continue task';
  } else if (latestCompletion.terminal_status === 'cancelled') {
    state = 'stopped';
    statusLabel = 'Stopped';
  } else if (latestCompletion.result_kind === 'plan' && planReview === null) {
    group = 'attention';
    state = 'waiting_plan_review';
    statusLabel = 'Review plan';
  } else if (latestCompletion.result_kind === 'candidate' && candidateReview === null) {
    group = 'attention';
    state = 'waiting_review';
    statusLabel = 'Review changes';
  } else if (planReview === 'approved') {
    statusLabel = 'Plan approved';
  } else if (candidateReview === 'accepted') {
    statusLabel = 'Version saved';
  } else if (planReview === 'rejected' || candidateReview === 'rejected') {
    statusLabel = 'Review closed';
  }

  return freezeDeep({
    group,
    state,
    status_label: statusLabel,
    latest_activity_at_ms: latestActivityAtMs,
    latest_result: {
      result_version: 'builder-workbench-task-result-summary.v1',
      result_id: resultId(task.task_address_id, latestCompletion.run_id),
      run_id: latestCompletion.run_id,
      sequence: latestCompletion.sequence,
      completed_at_ms: stream.conversation.created_at_ms + latestCompletion.sequence,
      terminal_status: latestCompletion.terminal_status,
      result_kind: latestCompletion.result_kind,
      summary: safeSummary(latestCompletion),
      review_state: latestCompletion.result_kind === 'plan'
        ? (planReview ?? 'pending')
        : latestCompletion.result_kind === 'candidate'
          ? (candidateReview ?? 'pending')
          : 'not_required',
    },
    attention: null,
  });
}

function createBuilderWorkbenchTaskMonitorProjection({
  address_store: addressStore,
  read_task_stream: readTaskStream,
  read_task_attention: readTaskAttention = () => null,
  read_task_controls: readTaskControls = () => [],
}) {
  const listTasks = stableMethod(addressStore, 'list_task_addresses_for_agent');
  const taskProjectionCache = new Map();
  if (
    typeof readTaskStream !== 'function'
    || utilTypes.isProxy(readTaskStream)
    || typeof readTaskAttention !== 'function'
    || utilTypes.isProxy(readTaskAttention)
    || typeof readTaskControls !== 'function'
    || utilTypes.isProxy(readTaskControls)
  ) fail();
  function validateScope(agentId, projectId, taskAddressId = null) {
    if (
      typeof agentId !== 'string'
      || !AGENT_ID_PATTERN.test(agentId)
      || (projectId !== null && (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)))
      || (taskAddressId !== null && (
        projectId === null
        || typeof taskAddressId !== 'string'
        || !TASK_ADDRESS_ID_PATTERN.test(taskAddressId)
      ))
    ) fail();
  }
  function cacheKey(agentId, task) {
    return `${agentId}:${task.task_address_id}`;
  }
  function taskSignature(task) {
    return JSON.stringify([
      task.project_id,
      task.conversation_id,
      task.title,
      task.goal,
      task.updated_at_ms,
    ]);
  }
  function projectTask(task) {
    let stream = null;
    try {
      stream = Reflect.apply(readTaskStream, undefined, [{
        project_id: task.project_id,
        conversation_id: task.conversation_id,
      }]);
    } catch {
      stream = null;
    }
    let attention = null;
    try {
      attention = Reflect.apply(readTaskAttention, undefined, [{
        project_id: task.project_id,
        task_address_id: task.task_address_id,
      }]);
    } catch {
      attention = null;
    }
    let derived = deriveTaskState(task, stream, attention);
    let controls;
    try {
      controls = Reflect.apply(readTaskControls, undefined, [{
        project_id: task.project_id,
        task_address_id: task.task_address_id,
      }]);
    } catch {
      controls = [];
    }
    if (
      !Array.isArray(controls)
      || controls.some((operation) => operation !== 'cancel_task')
      || new Set(controls).size !== controls.length
    ) fail();
    if (derived.state === 'working' && !controls.includes('cancel_task')) {
      derived = freezeDeep({
        group: 'attention',
        state: 'interrupted',
        status_label: 'Continue task',
        latest_activity_at_ms: derived.latest_activity_at_ms,
        latest_result: null,
        attention: null,
      });
    }
    const visibleControls = CANCELLABLE_TASK_STATES.has(derived.state)
      ? controls
      : Object.freeze([]);
    return freezeDeep({
      task_address_id: task.task_address_id,
      project_id: task.project_id,
      conversation_id: task.conversation_id,
      title: task.title,
      goal: task.goal,
      group: derived.group,
      state: derived.state,
      status_label: derived.status_label,
      latest_activity_at_ms: derived.latest_activity_at_ms,
      latest_result: derived.latest_result,
      attention: derived.attention,
      operations: ['open_task', ...visibleControls],
    });
  }
  function loadingTask(task) {
    return freezeDeep({
      task_address_id: task.task_address_id,
      project_id: task.project_id,
      conversation_id: task.conversation_id,
      title: task.title,
      goal: task.goal,
      group: 'active',
      state: 'draft',
      status_label: 'Loading task history',
      latest_activity_at_ms: task.updated_at_ms,
      latest_result: null,
      attention: null,
      operations: ['open_task'],
    });
  }
  return freezeDeep({
    projection_version: PROJECTION_VERSION,
    invalidate_monitor({ agent_id: agentId, project_id: projectId = null }) {
      validateScope(agentId, projectId);
      for (const [key, cached] of taskProjectionCache) {
        if (cached.agent_id === agentId && (projectId === null || cached.project_id === projectId)) {
          taskProjectionCache.delete(key);
        }
      }
      return freezeDeep({
        operation: 'task_monitor_invalidated',
        agent_id: agentId,
        project_id: projectId,
      });
    },
    read_monitor({
      agent_id: agentId,
      project_id: projectId = null,
      task_address_id: taskAddressId = null,
      cache_only: cacheOnly = false,
    }) {
      validateScope(agentId, projectId, taskAddressId);
      if (typeof cacheOnly !== 'boolean') fail();
      const listed = Reflect.apply(listTasks, addressStore, [{ agent_id: agentId, limit: 256 }]);
      if (listed?.status !== 'ready' || !Array.isArray(listed.task_addresses)) fail();
      const allTaskAddresses = listed.task_addresses.map((record) => {
        const task = record?.task_address;
        if (task?.agent_id !== agentId) fail();
        return task;
      });
      const listedKeys = new Set(allTaskAddresses.map((task) => cacheKey(agentId, task)));
      for (const [key, cached] of taskProjectionCache) {
        if (cached.agent_id === agentId && !listedKeys.has(key)) taskProjectionCache.delete(key);
      }
      const taskAddresses = allTaskAddresses.
        filter((task) => (
          (projectId === null || task.project_id === projectId)
          && (taskAddressId === null || task.task_address_id === taskAddressId)
        ));
      const tasks = taskAddresses.map((task) => {
        const key = cacheKey(agentId, task);
        const signature = taskSignature(task);
        const cached = taskProjectionCache.get(key);
        if (cached?.signature === signature) return cached.projection;
        if (cacheOnly) return loadingTask(task);
        const projection = projectTask(task);
        taskProjectionCache.set(key, freezeDeep({
          agent_id: agentId,
          project_id: task.project_id,
          signature,
          projection,
        }));
        return projection;
      }).sort((left, right) => (
        right.latest_activity_at_ms - left.latest_activity_at_ms
        || left.task_address_id.localeCompare(right.task_address_id)
      ));
      const counts = {
        active: tasks.filter((task) => task.group === 'active').length,
        attention: tasks.filter((task) => task.group === 'attention').length,
        recent: tasks.filter((task) => task.group === 'recent').length,
      };
      return freezeDeep({
        projection_version: PROJECTION_VERSION,
        agent_id: agentId,
        tasks,
        counts,
        authority: {
          task_identity: 'main_owned_session_task_address_store',
          task_state: 'sqlite_canonical_event_replay_plus_task_attention',
          renderer_authority: 'selection_only',
          provider_dispatch: false,
          permission_grant: false,
          source_read: false,
          source_write: false,
        },
      });
    },
  });
}

module.exports = Object.freeze({
  PROJECTION_VERSION,
  BuilderWorkbenchTaskMonitorProjectionError,
  createBuilderWorkbenchTaskMonitorProjection,
});
