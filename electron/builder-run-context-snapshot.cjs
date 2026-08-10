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
const {
  sanitizeBuilderProviderContextProjection,
} = require('./builder-provider-context-projection.cjs');
const {
  sanitizeBuilderProviderContextPromptEgressGate,
} = require('./builder-provider-context-prompt-egress-gate.cjs');
const {
  builderProjectUnderstandingSnapshotDigest,
  sanitizeBuilderProjectUnderstandingSnapshot,
} = require('./builder-project-understanding.cjs');

const SNAPSHOT_VERSION = 'builder-run-context-snapshot.v2';
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
  'project_understanding_ref',
  'context_assembly_ref',
  'provider_context_projection_ref',
  'provider_context_prompt_egress_gate_ref',
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
  'project_understanding_ref',
  'context_assembly_ref',
  'provider_context_projection_ref',
  'provider_context_prompt_egress_gate_ref',
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
const PROJECT_UNDERSTANDING_REF_KEYS = Object.freeze([
  'snapshot_digest',
  'source_tree_digest',
  'updated_at_ms',
]);
const PROJECT_UNDERSTANDING_RECORD_KEYS = Object.freeze([
  'snapshot_digest',
  'project_understanding_snapshot',
]);
const COMPACTION_REF_KEYS = Object.freeze(['summary_digest', 'source_range_digest', 'compacted_at_ms']);
const HANDOFF_REF_KEYS = Object.freeze(['packet_digest', 'inserted_at_ms', 'adopted_at_ms']);
const CONTEXT_ASSEMBLY_REF_KEYS = Object.freeze(['assembly_id', 'context_digest', 'assembled_at_ms']);
const PROVIDER_CONTEXT_PROJECTION_REF_KEYS = Object.freeze([
  'projection_id',
  'projection_status',
  'blocked_reason',
  'projected_at_ms',
]);
const PROVIDER_CONTEXT_PROMPT_EGRESS_GATE_REF_KEYS = Object.freeze([
  'gate_id',
  'prompt_egress_status',
  'blocked_reason',
  'next_required_step',
  'assessed_at_ms',
]);
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
const PROVIDER_CONTEXT_PROJECTION_ID_PATTERN = /^builder-provider-context-projection:[0-9a-f]{64}$/u;
const PROVIDER_CONTEXT_PROMPT_EGRESS_GATE_ID_PATTERN =
  /^builder-provider-context-prompt-egress-gate:[0-9a-f]{64}$/u;
const PROJECT_UNDERSTANDING_SNAPSHOT_DIGEST_PATTERN =
  /^builder-project-understanding-snapshot:[0-9a-f]{64}$/u;
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
  'project_understanding',
  'context_assembly',
  'provider_context_projection',
  'provider_context_prompt_egress_gate',
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

function sanitizeProjectUnderstandingRef(value, createdAtMs) {
  if (value === null) return null;
  const source = exactObject(value, PROJECT_UNDERSTANDING_REF_KEYS);
  const updatedAtMs = safeTimestamp(valueAt(source, 'updated_at_ms'));
  if (updatedAtMs > createdAtMs) fail();
  return {
    snapshot_digest: safePattern(
      valueAt(source, 'snapshot_digest'),
      PROJECT_UNDERSTANDING_SNAPSHOT_DIGEST_PATTERN,
    ),
    source_tree_digest: safePattern(valueAt(source, 'source_tree_digest'), DIGEST_PATTERN),
    updated_at_ms: updatedAtMs,
  };
}

function projectUnderstandingRefFromRecord(value, projectId, createdAtMs) {
  if (value === null) return null;
  const record = exactObject(value, PROJECT_UNDERSTANDING_RECORD_KEYS);
  const snapshot = sanitizeBuilderProjectUnderstandingSnapshot(
    valueAt(record, 'project_understanding_snapshot'),
  );
  const snapshotDigest = safePattern(
    valueAt(record, 'snapshot_digest'),
    PROJECT_UNDERSTANDING_SNAPSHOT_DIGEST_PATTERN,
  );
  if (
    snapshot.project_id !== projectId
    || snapshot.updated_at_ms > createdAtMs
    || builderProjectUnderstandingSnapshotDigest(snapshot) !== snapshotDigest
  ) fail();
  return sanitizeProjectUnderstandingRef({
    snapshot_digest: snapshotDigest,
    source_tree_digest: snapshot.source_tree_digest,
    updated_at_ms: snapshot.updated_at_ms,
  }, createdAtMs);
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

function sanitizeProviderContextProjectionRef(value, contextAssemblyRef) {
  const source = exactObject(value, PROVIDER_CONTEXT_PROJECTION_REF_KEYS);
  const projectionId = nullable(
    valueAt(source, 'projection_id'),
    (item) => safePattern(item, PROVIDER_CONTEXT_PROJECTION_ID_PATTERN),
  );
  const projectionStatus = nullable(
    valueAt(source, 'projection_status'),
    (item) => safeEnum(item, ['blocked', 'ready']),
  );
  const blockedReason = nullable(
    valueAt(source, 'blocked_reason'),
    (item) => safeEnum(item, ['context_disclosure_not_approved', 'context_disclosure_denied']),
  );
  const projectedAtMs = nullable(valueAt(source, 'projected_at_ms'), safeTimestamp);
  if (
    (projectionId === null) !== (projectionStatus === null)
    || (projectionId === null) !== (projectedAtMs === null)
    || (projectionId === null && blockedReason !== null)
    || (projectionStatus === 'ready' && blockedReason !== null)
    || (projectionStatus === 'blocked' && blockedReason === null)
    || (projectionId !== null && contextAssemblyRef.assembly_id === null)
  ) fail();
  return {
    projection_id: projectionId,
    projection_status: projectionStatus,
    blocked_reason: blockedReason,
    projected_at_ms: projectedAtMs,
  };
}

function providerContextProjectionRefFromProjection(value, contextAssemblyRef) {
  if (value === null) {
    return {
      projection_id: null,
      projection_status: null,
      blocked_reason: null,
      projected_at_ms: null,
    };
  }
  const projection = sanitizeBuilderProviderContextProjection(value);
  if (
    projection.source_refs.assembly_id !== contextAssemblyRef.assembly_id
    || projection.source_refs.context_digest !== contextAssemblyRef.context_digest
  ) fail();
  return {
    projection_id: projection.projection_id,
    projection_status: projection.projection_status,
    blocked_reason: projection.blocked_reason,
    projected_at_ms: projection.projected_at_ms,
  };
}

function sanitizeProviderContextPromptEgressGateRef(value, providerContextProjectionRef) {
  const source = exactObject(value, PROVIDER_CONTEXT_PROMPT_EGRESS_GATE_REF_KEYS);
  const gateId = nullable(
    valueAt(source, 'gate_id'),
    (item) => safePattern(item, PROVIDER_CONTEXT_PROMPT_EGRESS_GATE_ID_PATTERN),
  );
  const promptEgressStatus = nullable(
    valueAt(source, 'prompt_egress_status'),
    (item) => safeEnum(item, ['blocked_by_context_disclosure', 'blocked_by_prompt_bridge']),
  );
  const blockedReason = nullable(
    valueAt(source, 'blocked_reason'),
    (item) => safeEnum(item, [
      'context_disclosure_not_approved',
      'context_disclosure_denied',
      'prompt_bridge_not_enabled',
    ]),
  );
  const nextRequiredStep = nullable(
    valueAt(source, 'next_required_step'),
    (item) => safeEnum(item, [
      'approve_context_disclosure',
      'context_disclosure_denied',
      'implement_explicit_prompt_bridge',
    ]),
  );
  const assessedAtMs = nullable(valueAt(source, 'assessed_at_ms'), safeTimestamp);
  if (
    (gateId === null) !== (promptEgressStatus === null)
    || (gateId === null) !== (blockedReason === null)
    || (gateId === null) !== (nextRequiredStep === null)
    || (gateId === null) !== (assessedAtMs === null)
    || (gateId === null && providerContextProjectionRef.projection_id !== null)
    || (gateId !== null && providerContextProjectionRef.projection_id === null)
    || (
      promptEgressStatus === 'blocked_by_prompt_bridge'
      && (
        providerContextProjectionRef.projection_status !== 'ready'
        || blockedReason !== 'prompt_bridge_not_enabled'
        || nextRequiredStep !== 'implement_explicit_prompt_bridge'
      )
    )
    || (
      promptEgressStatus === 'blocked_by_context_disclosure'
      && (
        providerContextProjectionRef.projection_status !== 'blocked'
        || blockedReason !== providerContextProjectionRef.blocked_reason
        || (
          blockedReason === 'context_disclosure_not_approved'
          && nextRequiredStep !== 'approve_context_disclosure'
        )
        || (
          blockedReason === 'context_disclosure_denied'
          && nextRequiredStep !== 'context_disclosure_denied'
        )
      )
    )
    || (assessedAtMs !== null && assessedAtMs < providerContextProjectionRef.projected_at_ms)
  ) fail();
  return {
    gate_id: gateId,
    prompt_egress_status: promptEgressStatus,
    blocked_reason: blockedReason,
    next_required_step: nextRequiredStep,
    assessed_at_ms: assessedAtMs,
  };
}

function providerContextPromptEgressGateRefFromGate(value, providerContextProjectionRef) {
  if (value === null) {
    return {
      gate_id: null,
      prompt_egress_status: null,
      blocked_reason: null,
      next_required_step: null,
      assessed_at_ms: null,
    };
  }
  const gate = sanitizeBuilderProviderContextPromptEgressGate(value);
  if (
    gate.source_ref.projection_id !== providerContextProjectionRef.projection_id
    || gate.source_ref.projected_at_ms !== providerContextProjectionRef.projected_at_ms
    || gate.projection_status !== providerContextProjectionRef.projection_status
  ) fail();
  return {
    gate_id: gate.gate_id,
    prompt_egress_status: gate.prompt_egress_status,
    blocked_reason: gate.blocked_reason,
    next_required_step: gate.next_required_step,
    assessed_at_ms: gate.assessed_at_ms,
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
    project_source: safeEnum(valueAt(source, 'project_source'), [
      'base_revision_reference_only',
      'selected_local_workspace_reference',
      'unsaved_project_reference_only',
    ]),
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
  const projectUnderstandingRef = sanitizeProjectUnderstandingRef(
    valueAt(source, 'project_understanding_ref'),
    createdAtMs,
  );
  const contextAssemblyRef = sanitizeContextAssemblyRef(
    valueAt(source, 'context_assembly_ref'),
    createdAtMs,
    contextRefs,
  );
  const providerContextProjectionRef = sanitizeProviderContextProjectionRef(
    valueAt(source, 'provider_context_projection_ref'),
    contextAssemblyRef,
  );
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
    project_understanding_ref: projectUnderstandingRef,
    context_assembly_ref: contextAssemblyRef,
    provider_context_projection_ref: providerContextProjectionRef,
    provider_context_prompt_egress_gate_ref: sanitizeProviderContextPromptEgressGateRef(
      valueAt(source, 'provider_context_prompt_egress_gate_ref'),
      providerContextProjectionRef,
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
    project_understanding_ref: valueAt(source, 'project_understanding_ref'),
    context_assembly_ref: valueAt(source, 'context_assembly_ref'),
    provider_context_projection_ref: valueAt(source, 'provider_context_projection_ref'),
    provider_context_prompt_egress_gate_ref: valueAt(source, 'provider_context_prompt_egress_gate_ref'),
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
  const contextAssemblyRef = contextAssemblyRefFromAssembly(
    valueAt(source, 'context_assembly'),
    projectId,
    contextRefs,
  );
  const providerContextProjectionRef = providerContextProjectionRefFromProjection(
    valueAt(source, 'provider_context_projection'),
    contextAssemblyRef,
  );
  const projectUnderstandingRef = projectUnderstandingRefFromRecord(
    valueAt(source, 'project_understanding'),
    projectId,
    safeTimestamp(valueAt(source, 'created_at_ms')),
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
    project_understanding_ref: projectUnderstandingRef,
    context_assembly_ref: contextAssemblyRef,
    provider_context_projection_ref: providerContextProjectionRef,
    provider_context_prompt_egress_gate_ref: providerContextPromptEgressGateRefFromGate(
      valueAt(source, 'provider_context_prompt_egress_gate'),
      providerContextProjectionRef,
    ),
    base_revision: valueAt(source, 'base_revision'),
    permissions: {
      required_permissions: valueAt(routeDecisionSource, 'required_permissions'),
      permission_result: valueAt(routeDecisionSource, 'permission_result'),
      admission_source: 'route_decision',
    },
    capabilities: {
      project_source: valueAt(source, 'base_revision') === null
        ? projectUnderstandingRef === null
          ? 'unsaved_project_reference_only'
          : 'selected_local_workspace_reference'
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
