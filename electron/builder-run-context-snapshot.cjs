'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  isPublicBuilderRouteDecisionSignal,
} = require('./builder-route-decision-signals.cjs');
const {
  sanitizeBuilderWorkingContextState,
} = require('./builder-working-context-state.cjs');
const {
  sanitizeBuilderContextAssembly,
} = require('./builder-context-assembler.cjs');

const SNAPSHOT_VERSION = 'builder-run-context-snapshot.v1';
const SNAPSHOT_ID_PREFIX = 'builder-run-context-snapshot:';
const SNAPSHOT_KEYS = Object.freeze([
  'snapshot_version',
  'snapshot_id',
  'project_id',
  'conversation_id',
  'turn_id',
  'run_id',
  'task_id',
  'included_message_ids',
  'route_decision',
  'brief_reference',
  'context_refs',
  'context_assembly_ref',
  'base_revision',
  'permissions',
  'capabilities',
  'created_at_ms',
  'context_digest',
]);
const SNAPSHOT_BODY_KEYS = Object.freeze([
  'snapshot_version',
  'project_id',
  'conversation_id',
  'turn_id',
  'run_id',
  'task_id',
  'included_message_ids',
  'route_decision',
  'brief_reference',
  'context_refs',
  'context_assembly_ref',
  'base_revision',
  'permissions',
  'capabilities',
  'created_at_ms',
]);
const ROUTE_DECISION_KEYS = Object.freeze([
  'decision_id',
  'route',
  'dispatch',
  'matched_signals',
  'downgraded_from',
  'downgrade_reason',
]);
const BRIEF_REFERENCE_KEYS = Object.freeze([
  'status',
  'task_id',
  'source_message_id',
  'last_route_decision_id',
  'contextual_build_ready',
]);
const CONTEXT_REFS_KEYS = Object.freeze([
  'working_context_state_id',
  'working_context_state_updated_at_ms',
  'compaction_refs',
  'handoff_refs',
]);
const COMPACTION_REF_KEYS = Object.freeze(['summary_digest', 'source_range_digest', 'compacted_at_ms']);
const HANDOFF_REF_KEYS = Object.freeze(['packet_digest', 'inserted_at_ms', 'adopted_at_ms']);
const CONTEXT_ASSEMBLY_REF_KEYS = Object.freeze(['assembly_id', 'context_digest', 'assembled_at_ms']);
const BASE_REVISION_KEYS = Object.freeze(['revision_receipt_digest', 'commit_oid']);
const PERMISSIONS_KEYS = Object.freeze([
  'required_permissions',
  'permission_result',
  'admission_source',
]);
const CAPABILITIES_KEYS = Object.freeze([
  'project_source',
  'command_execution',
  'network_access',
]);

const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN = /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MESSAGE_ID_PATTERN = /^builder-message:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ROUTE_DECISION_ID_PATTERN = /^builder-route-decision:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN = /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ID_PATTERN = /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN = /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SNAPSHOT_ID_PATTERN = /^builder-run-context-snapshot:[0-9a-f]{64}$/u;
const CONTEXT_ASSEMBLY_ID_PATTERN = /^builder-context-assembly:[0-9a-f]{64}$/u;
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/u;
const ROUTES = Object.freeze(['answer', 'clarify', 'update_brief', 'plan', 'build']);
const DISPATCHES = Object.freeze(['reply', 'brief_update', 'plan', 'build', 'ask_workspace', 'ask_permission', 'blocked']);
const DOWNGRADE_REASONS = Object.freeze(['ambiguous_build_intent', 'missing_prior_build_context', 'workspace_required']);
const PERMISSIONS = Object.freeze(['project_read', 'write_project']);
const PERMISSION_RESULTS = Object.freeze(['not_required', 'allowed', 'ask', 'denied']);
const CREATE_INPUT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'run_id',
  'task_id',
  'message_id',
  'route_decision',
  'latest_task_capsule',
  'working_context_state',
  'context_assembly',
  'base_revision',
  'created_at_ms',
]);

class BuilderRunContextSnapshotError extends Error {
  constructor() {
    super('The run context snapshot could not be verified.');
    this.name = 'BuilderRunContextSnapshotError';
    this.code = 'builder_run_context_snapshot_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderRunContextSnapshotError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
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

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function nullable(value, sanitizer) {
  return value === null ? null : sanitizer(value);
}

function denseMessageIds(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > 4
  ) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  const messageIds = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const messageId = safePattern(descriptor.value, MESSAGE_ID_PATTERN);
    if (seen.has(messageId)) fail();
    seen.add(messageId);
    messageIds.push(messageId);
  }
  return messageIds;
}

function denseSignals(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > 8
  ) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => typeof key === 'symbol')) fail();
  const signals = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const signal = descriptor.value;
    if (!isPublicBuilderRouteDecisionSignal(signal) || seen.has(signal)) fail();
    seen.add(signal);
    signals.push(signal);
  }
  return signals;
}

function densePermissions(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > 2
  ) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => typeof key === 'symbol')) fail();
  const permissions = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const permission = safeEnum(descriptor.value, PERMISSIONS);
    if (seen.has(permission)) fail();
    seen.add(permission);
    permissions.push(permission);
  }
  return permissions;
}

function sanitizeRouteDecision(value) {
  const source = exactObject(value, ROUTE_DECISION_KEYS);
  return {
    decision_id: safePattern(valueAt(source, 'decision_id'), ROUTE_DECISION_ID_PATTERN),
    route: safeEnum(valueAt(source, 'route'), ROUTES),
    dispatch: safeEnum(valueAt(source, 'dispatch'), DISPATCHES),
    matched_signals: denseSignals(valueAt(source, 'matched_signals')),
    downgraded_from: nullable(valueAt(source, 'downgraded_from'), (item) => safeEnum(item, ROUTES)),
    downgrade_reason: nullable(valueAt(source, 'downgrade_reason'), (item) => safeEnum(item, DOWNGRADE_REASONS)),
  };
}

function sanitizeBriefReference(value) {
  const source = exactObject(value, BRIEF_REFERENCE_KEYS);
  const status = safeEnum(valueAt(source, 'status'), ['not_available', 'task_capsule_update']);
  const taskId = nullable(valueAt(source, 'task_id'), (item) => safePattern(item, TASK_ID_PATTERN));
  const sourceMessageId = nullable(valueAt(source, 'source_message_id'), (item) => safePattern(item, MESSAGE_ID_PATTERN));
  const lastRouteDecisionId = nullable(
    valueAt(source, 'last_route_decision_id'),
    (item) => safePattern(item, ROUTE_DECISION_ID_PATTERN),
  );
  const contextualBuildReady = valueAt(source, 'contextual_build_ready');
  if (typeof contextualBuildReady !== 'boolean') fail();
  if (status === 'not_available') {
    if (
      taskId !== null
      || sourceMessageId !== null
      || lastRouteDecisionId !== null
      || contextualBuildReady !== false
    ) fail();
  } else if (
    taskId === null
    || sourceMessageId === null
    || lastRouteDecisionId === null
    || contextualBuildReady !== true
  ) fail();
  return {
    status,
    task_id: taskId,
    source_message_id: sourceMessageId,
    last_route_decision_id: lastRouteDecisionId,
    contextual_build_ready: contextualBuildReady,
  };
}

function denseCompactionRefs(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > 4
  ) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => typeof key === 'symbol')) fail();
  const refs = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const source = exactObject(descriptor.value, COMPACTION_REF_KEYS);
    const summaryDigest = safePattern(valueAt(source, 'summary_digest'), DIGEST_PATTERN);
    const sourceRangeDigest = safePattern(valueAt(source, 'source_range_digest'), DIGEST_PATTERN);
    const key = `${summaryDigest}:${sourceRangeDigest}`;
    if (seen.has(key)) fail();
    seen.add(key);
    refs.push({
      summary_digest: summaryDigest,
      source_range_digest: sourceRangeDigest,
      compacted_at_ms: safeTimestamp(valueAt(source, 'compacted_at_ms')),
    });
  }
  return refs;
}

function denseHandoffRefs(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > 4
  ) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => typeof key === 'symbol')) fail();
  const refs = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const source = exactObject(descriptor.value, HANDOFF_REF_KEYS);
    const packetDigest = safePattern(valueAt(source, 'packet_digest'), DIGEST_PATTERN);
    if (seen.has(packetDigest)) fail();
    seen.add(packetDigest);
    const insertedAtMs = safeTimestamp(valueAt(source, 'inserted_at_ms'));
    const adoptedAtMs = safeTimestamp(valueAt(source, 'adopted_at_ms'));
    if (adoptedAtMs < insertedAtMs) fail();
    refs.push({
      packet_digest: packetDigest,
      inserted_at_ms: insertedAtMs,
      adopted_at_ms: adoptedAtMs,
    });
  }
  return refs;
}

function sanitizeContextRefs(value, createdAtMs) {
  const source = exactObject(value, CONTEXT_REFS_KEYS);
  const workingContextStateId = nullable(
    valueAt(source, 'working_context_state_id'),
    (item) => safePattern(item, /^builder-working-context-state:[0-9a-f]{64}$/u),
  );
  const workingContextStateUpdatedAtMs = nullable(
    valueAt(source, 'working_context_state_updated_at_ms'),
    safeTimestamp,
  );
  const compactionRefs = denseCompactionRefs(valueAt(source, 'compaction_refs'));
  const handoffRefs = denseHandoffRefs(valueAt(source, 'handoff_refs'));
  if (
    (workingContextStateId === null) !== (workingContextStateUpdatedAtMs === null)
    || (workingContextStateUpdatedAtMs !== null && workingContextStateUpdatedAtMs > createdAtMs)
    || (workingContextStateId === null && (compactionRefs.length > 0 || handoffRefs.length > 0))
    || compactionRefs.some((ref) => ref.compacted_at_ms > createdAtMs)
    || handoffRefs.some((ref) => ref.inserted_at_ms > createdAtMs || ref.adopted_at_ms > createdAtMs)
  ) fail();
  return {
    working_context_state_id: workingContextStateId,
    working_context_state_updated_at_ms: workingContextStateUpdatedAtMs,
    compaction_refs: compactionRefs,
    handoff_refs: handoffRefs,
  };
}

function contextRefsFromWorkingContextState(value, projectId, conversationId) {
  if (value === null) {
    return {
      working_context_state_id: null,
      working_context_state_updated_at_ms: null,
      compaction_refs: [],
      handoff_refs: [],
    };
  }
  const state = sanitizeBuilderWorkingContextState(value);
  if (state.project_id !== projectId || state.conversation_id !== conversationId) fail();
  return {
    working_context_state_id: state.state_id,
    working_context_state_updated_at_ms: state.updated_at_ms,
    compaction_refs: state.compaction_refs.map((ref) => ({ ...ref })),
    handoff_refs: state.handoff_refs.map((ref) => ({ ...ref })),
  };
}

function sanitizeContextAssemblyRef(value, createdAtMs, contextRefs) {
  const source = exactObject(value, CONTEXT_ASSEMBLY_REF_KEYS);
  const assemblyId = nullable(
    valueAt(source, 'assembly_id'),
    (item) => safePattern(item, CONTEXT_ASSEMBLY_ID_PATTERN),
  );
  const contextDigest = nullable(valueAt(source, 'context_digest'), (item) => safePattern(item, DIGEST_PATTERN));
  const assembledAtMs = nullable(valueAt(source, 'assembled_at_ms'), safeTimestamp);
  if (
    (assemblyId === null) !== (contextDigest === null)
    || (assemblyId === null) !== (assembledAtMs === null)
    || (assembledAtMs !== null && assembledAtMs > createdAtMs)
    || (
      assemblyId !== null
      && contextRefs.working_context_state_id === null
    )
  ) fail();
  return {
    assembly_id: assemblyId,
    context_digest: contextDigest,
    assembled_at_ms: assembledAtMs,
  };
}

function contextAssemblyRefFromAssembly(value, projectId, contextRefs) {
  if (value === null) {
    return {
      assembly_id: null,
      context_digest: null,
      assembled_at_ms: null,
    };
  }
  const assembly = sanitizeBuilderContextAssembly(value);
  if (
    assembly.project_id !== projectId
    || assembly.run_snapshot_refs.working_context_state_id !== contextRefs.working_context_state_id
    || assembly.run_snapshot_refs.working_context_state_updated_at_ms !== contextRefs.working_context_state_updated_at_ms
    || canonicalJson(assembly.run_snapshot_refs.compaction_refs) !== canonicalJson(contextRefs.compaction_refs)
    || canonicalJson(assembly.run_snapshot_refs.handoff_refs) !== canonicalJson(contextRefs.handoff_refs)
  ) fail();
  return {
    assembly_id: assembly.assembly_id,
    context_digest: assembly.context_digest,
    assembled_at_ms: assembly.assembled_at_ms,
  };
}

function sanitizeBaseRevision(value) {
  if (value === null) return null;
  const source = exactObject(value, BASE_REVISION_KEYS);
  return {
    revision_receipt_digest: safePattern(valueAt(source, 'revision_receipt_digest'), DIGEST_PATTERN),
    commit_oid: safePattern(valueAt(source, 'commit_oid'), GIT_OID_PATTERN),
  };
}

function sanitizePermissions(value) {
  const source = exactObject(value, PERMISSIONS_KEYS);
  return {
    required_permissions: densePermissions(valueAt(source, 'required_permissions')),
    permission_result: safeEnum(valueAt(source, 'permission_result'), PERMISSION_RESULTS),
    admission_source: safeEnum(valueAt(source, 'admission_source'), ['route_decision']),
  };
}

function sanitizeCapabilities(value) {
  const source = exactObject(value, CAPABILITIES_KEYS);
  return {
    project_source: safeEnum(valueAt(source, 'project_source'), ['base_revision_reference_only', 'new_project_empty_base']),
    command_execution: safeEnum(valueAt(source, 'command_execution'), ['not_included']),
    network_access: safeEnum(valueAt(source, 'network_access'), ['not_included']),
  };
}

function snapshotBodyFrom(value) {
  const source = exactObject(value, SNAPSHOT_BODY_KEYS);
  const projectId = safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN);
  const conversationId = safePattern(valueAt(source, 'conversation_id'), CONVERSATION_ID_PATTERN);
  if (conversationId.slice('builder-conversation:'.length) !== projectId.slice('builder-project:'.length)) fail();
  const taskId = nullable(valueAt(source, 'task_id'), (item) => safePattern(item, TASK_ID_PATTERN));
  const includedMessageIds = denseMessageIds(valueAt(source, 'included_message_ids'));
  const briefReference = sanitizeBriefReference(valueAt(source, 'brief_reference'));
  const createdAtMs = safeTimestamp(valueAt(source, 'created_at_ms'));
  const contextRefs = sanitizeContextRefs(valueAt(source, 'context_refs'), createdAtMs);
  if (
    briefReference.status === 'task_capsule_update'
    && !includedMessageIds.includes(briefReference.source_message_id)
  ) fail();
  return {
    snapshot_version: valueAt(source, 'snapshot_version') === SNAPSHOT_VERSION ? SNAPSHOT_VERSION : fail(),
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: safePattern(valueAt(source, 'turn_id'), TURN_ID_PATTERN),
    run_id: safePattern(valueAt(source, 'run_id'), RUN_ID_PATTERN),
    task_id: taskId,
    included_message_ids: includedMessageIds,
    route_decision: sanitizeRouteDecision(valueAt(source, 'route_decision')),
    brief_reference: briefReference,
    context_refs: contextRefs,
    context_assembly_ref: sanitizeContextAssemblyRef(
      valueAt(source, 'context_assembly_ref'),
      createdAtMs,
      contextRefs,
    ),
    base_revision: sanitizeBaseRevision(valueAt(source, 'base_revision')),
    permissions: sanitizePermissions(valueAt(source, 'permissions')),
    capabilities: sanitizeCapabilities(valueAt(source, 'capabilities')),
    created_at_ms: createdAtMs,
  };
}

function withDigest(body) {
  const contextDigest = sha256Canonical(body);
  return freezeDeep({
    ...body,
    snapshot_id: `${SNAPSHOT_ID_PREFIX}${contextDigest.slice('sha256:'.length)}`,
    context_digest: contextDigest,
  });
}

function sanitizeBuilderRunContextSnapshot(value, expected = null) {
  const source = exactObject(value, SNAPSHOT_KEYS);
  const body = snapshotBodyFrom({
    snapshot_version: valueAt(source, 'snapshot_version'),
    project_id: valueAt(source, 'project_id'),
    conversation_id: valueAt(source, 'conversation_id'),
    turn_id: valueAt(source, 'turn_id'),
    run_id: valueAt(source, 'run_id'),
    task_id: valueAt(source, 'task_id'),
    included_message_ids: valueAt(source, 'included_message_ids'),
    route_decision: valueAt(source, 'route_decision'),
    brief_reference: valueAt(source, 'brief_reference'),
    context_refs: valueAt(source, 'context_refs'),
    context_assembly_ref: valueAt(source, 'context_assembly_ref'),
    base_revision: valueAt(source, 'base_revision'),
    permissions: valueAt(source, 'permissions'),
    capabilities: valueAt(source, 'capabilities'),
    created_at_ms: valueAt(source, 'created_at_ms'),
  });
  const normalized = withDigest(body);
  if (
    valueAt(source, 'snapshot_id') !== normalized.snapshot_id
    || safePattern(valueAt(source, 'snapshot_id'), SNAPSHOT_ID_PATTERN) !== normalized.snapshot_id
    || valueAt(source, 'context_digest') !== normalized.context_digest
  ) fail();
  if (expected !== null) {
    const guard = exactObject(expected, ['project_id', 'conversation_id', 'turn_id', 'run_id', 'task_id']);
    if (
      normalized.project_id !== valueAt(guard, 'project_id')
      || normalized.conversation_id !== valueAt(guard, 'conversation_id')
      || normalized.turn_id !== valueAt(guard, 'turn_id')
      || normalized.run_id !== valueAt(guard, 'run_id')
      || normalized.task_id !== valueAt(guard, 'task_id')
    ) fail();
  }
  return normalized;
}

function createBuilderRunContextSnapshot(input) {
  const source = exactObject(input, CREATE_INPUT_KEYS);
  const routeDecisionSource = exactObject(valueAt(source, 'route_decision'), [
    'decision_id',
    'decision_version',
    'project_id',
    'message_id',
    'task_id',
    'route',
    'confidence',
    'matched_signals',
    'downgraded_from',
    'downgrade_reason',
    'required_permissions',
    'permission_result',
    'dispatch',
    'decided_at_ms',
  ]);
  const projectId = safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN);
  const conversationId = safePattern(valueAt(source, 'conversation_id'), CONVERSATION_ID_PATTERN);
  const taskId = nullable(valueAt(source, 'task_id'), (item) => safePattern(item, TASK_ID_PATTERN));
  const messageId = safePattern(valueAt(source, 'message_id'), MESSAGE_ID_PATTERN);
  const routeDecisionProjectId = safePattern(valueAt(routeDecisionSource, 'project_id'), PROJECT_ID_PATTERN);
  const routeDecisionMessageId = safePattern(valueAt(routeDecisionSource, 'message_id'), MESSAGE_ID_PATTERN);
  const routeDecisionTaskId = nullable(
    valueAt(routeDecisionSource, 'task_id'),
    (item) => safePattern(item, TASK_ID_PATTERN),
  );
  if (
    routeDecisionProjectId !== projectId
    || routeDecisionMessageId !== messageId
    || routeDecisionTaskId !== taskId
  ) fail();
  const routeDecision = sanitizeRouteDecision({
    decision_id: valueAt(routeDecisionSource, 'decision_id'),
    route: valueAt(routeDecisionSource, 'route'),
    dispatch: valueAt(routeDecisionSource, 'dispatch'),
    matched_signals: valueAt(routeDecisionSource, 'matched_signals'),
    downgraded_from: valueAt(routeDecisionSource, 'downgraded_from'),
    downgrade_reason: valueAt(routeDecisionSource, 'downgrade_reason'),
  });
  const taskCapsuleReference = valueAt(source, 'latest_task_capsule');
  const taskCapsule = taskCapsuleReference === null ? null : valueAt(taskCapsuleReference, 'task_capsule');
  if (taskCapsule !== null) {
    const currentBrief = valueAt(taskCapsule, 'current_brief');
    if (
      valueAt(taskCapsule, 'status') !== 'ready'
      || !isPlainObject(currentBrief)
      || valueAt(currentBrief, 'use_when_instruction_is_contextual') !== true
    ) fail();
  }
  const sourceMessageId = taskCapsuleReference === null
    ? null
    : safePattern(valueAt(taskCapsuleReference, 'message_id'), MESSAGE_ID_PATTERN);
  const includedMessageIds = [messageId];
  if (sourceMessageId !== null && sourceMessageId !== messageId) includedMessageIds.push(sourceMessageId);
  const contextRefs = contextRefsFromWorkingContextState(
    valueAt(source, 'working_context_state'),
    projectId,
    conversationId,
  );
  const body = snapshotBodyFrom({
    snapshot_version: SNAPSHOT_VERSION,
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: valueAt(source, 'turn_id'),
    run_id: valueAt(source, 'run_id'),
    task_id: taskId,
    included_message_ids: includedMessageIds,
    route_decision: routeDecision,
    brief_reference: taskCapsule === null ? {
      status: 'not_available',
      task_id: null,
      source_message_id: null,
      last_route_decision_id: null,
      contextual_build_ready: false,
    } : {
      status: 'task_capsule_update',
      task_id: valueAt(taskCapsule, 'task_id'),
      source_message_id: sourceMessageId,
      last_route_decision_id: valueAt(taskCapsule, 'last_route_decision_id'),
      contextual_build_ready: true,
    },
    context_refs: contextRefs,
    context_assembly_ref: contextAssemblyRefFromAssembly(
      valueAt(source, 'context_assembly'),
      projectId,
      contextRefs,
    ),
    base_revision: valueAt(source, 'base_revision'),
    permissions: {
      required_permissions: valueAt(routeDecisionSource, 'required_permissions'),
      permission_result: valueAt(routeDecisionSource, 'permission_result'),
      admission_source: 'route_decision',
    },
    capabilities: {
      project_source: valueAt(source, 'base_revision') === null
        ? 'new_project_empty_base'
        : 'base_revision_reference_only',
      command_execution: 'not_included',
      network_access: 'not_included',
    },
    created_at_ms: valueAt(source, 'created_at_ms'),
  });
  return withDigest(body);
}

module.exports = Object.freeze({
  SNAPSHOT_VERSION,
  BuilderRunContextSnapshotError,
  createBuilderRunContextSnapshot,
  sanitizeBuilderRunContextSnapshot,
});
