'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderWorkingContextState,
} = require('./builder-working-context-state.cjs');

const BUILDER_CONTEXT_ASSEMBLY_VERSION = 'builder-context-assembly.v1';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const WORKING_CONTEXT_STATE_ID_PATTERN = /^builder-working-context-state:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_PATTERN = /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;

const INPUT_KEYS = Object.freeze([
  'assembly_purpose',
  'project_id',
  'latest_user_message',
  'working_context_state',
  'approved_plan_ref',
  'current_result_ref',
  'selected_source_summaries',
  'compaction_summaries',
  'adopted_handoff_packets',
  'permission_state',
  'context_budget',
  'assembled_at_ms',
]);
const ASSEMBLY_KEYS = Object.freeze([
  'assembly_version',
  'assembly_id',
  'assembly_purpose',
  'project_id',
  'working_context_state_id',
  'working_context_state_status',
  'model_context_segments',
  'omitted_refs',
  'context_budget',
  'context_digest',
  'run_snapshot_refs',
  'permission_gate',
  'assembled_at_ms',
  'authority',
]);
const SEGMENT_KEYS = Object.freeze(['segment_kind', 'source_ref', 'text', 'byte_length']);
const SOURCE_REF_KEYS = Object.freeze(['ref_kind', 'ref_digest']);
const OMITTED_REF_KEYS = Object.freeze(['ref_kind', 'ref_digest', 'reason']);
const APPROVED_PLAN_REF_KEYS = Object.freeze(['plan_result_digest', 'conversation_head_digest', 'approved_at_ms']);
const CURRENT_RESULT_REF_KEYS = Object.freeze(['result_kind', 'result_digest', 'recorded_at_ms']);
const SOURCE_SUMMARY_KEYS = Object.freeze(['source_kind', 'source_digest', 'summary', 'priority']);
const COMPACTION_SUMMARY_KEYS = Object.freeze(['summary_digest', 'source_range_digest', 'summary', 'compacted_at_ms']);
const HANDOFF_PACKET_KEYS = Object.freeze(['packet_digest', 'summary', 'adopted_at_ms']);
const PERMISSION_STATE_KEYS = Object.freeze(['workspace_state', 'write_permission']);
const CONTEXT_BUDGET_INPUT_KEYS = Object.freeze(['max_segments', 'max_prompt_bytes', 'reserved_response_bytes']);
const CONTEXT_BUDGET_KEYS = Object.freeze([
  'max_segments',
  'max_prompt_bytes',
  'used_prompt_bytes',
  'reserved_response_bytes',
]);
const RUN_SNAPSHOT_REFS_KEYS = Object.freeze([
  'working_context_state_id',
  'working_context_state_updated_at_ms',
  'compaction_refs',
  'handoff_refs',
]);
const COMPACTION_REF_KEYS = Object.freeze(['summary_digest', 'source_range_digest', 'compacted_at_ms']);
const HANDOFF_REF_KEYS = Object.freeze(['packet_digest', 'inserted_at_ms', 'adopted_at_ms']);
const PERMISSION_GATE_KEYS = Object.freeze(['workspace_state', 'write_permission', 'side_effect_ready']);
const AUTHORITY_KEYS = Object.freeze([
  'context_assembler_authority',
  'working_context_state',
  'context_sources',
  'renderer_authority',
  'sqlite_read',
  'sqlite_write',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'permission_grant',
  'revision_admission',
]);

const ASSEMBLY_PURPOSES = Object.freeze(['answer', 'plan', 'contextual_build']);
const SIDE_EFFECT_PURPOSES = Object.freeze(['contextual_build']);
const WORKING_CONTEXT_STATES = Object.freeze([
  'empty',
  'discussing',
  'ready',
  'stale',
  'approved_plan_ready',
  'needs_clarification',
]);
const SEGMENT_KINDS = Object.freeze([
  'latest_user_message',
  'working_context_objective',
  'working_context_constraints',
  'approved_plan',
  'current_result',
  'selected_source_summary',
  'compaction_summary',
  'handoff_summary',
]);
const SOURCE_REF_KINDS = Object.freeze([
  'user_message',
  'working_context_state',
  'approved_plan',
  'current_result',
  'selected_source',
  'compaction_summary',
  'handoff_packet',
]);
const OMIT_REASONS = Object.freeze(['budget_exceeded', 'segment_limit']);
const SOURCE_KINDS = Object.freeze(['project_summary', 'selected_file', 'artifact_summary', 'diff_summary']);
const CURRENT_RESULT_KINDS = Object.freeze(['draft', 'saved_revision', 'preview', 'plan']);
const WORKSPACE_STATES = Object.freeze(['bound', 'missing']);
const WRITE_PERMISSIONS = Object.freeze(['not_required', 'allowed', 'ask', 'denied']);
const AUTHORITY = Object.freeze({
  context_assembler_authority: 'main_context_assembler_contract_v1',
  working_context_state: 'caller_provided_verified',
  context_sources: 'caller_provided_bounded_summaries',
  renderer_authority: 'not_present',
  sqlite_read: 'not_performed',
  sqlite_write: 'not_performed',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_created',
});

const ERROR_MESSAGE = 'Builder context assembly could not be verified.';

class BuilderContextAssemblerError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderContextAssemblerError';
    this.code = 'builder_context_assembler_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderContextAssemblerError();
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
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function digestId(prefix, body) {
  return `${prefix}:${nodeCrypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex')}`;
}

function digest(body) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 64);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 80);
}

function safeWorkingContextStateId(value) {
  return safePattern(value, WORKING_CONTEXT_STATE_ID_PATTERN, 96);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeCount(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasControl(value, allowFormatting) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f
      && !(allowFormatting && (code === 0x09 || code === 0x0a || code === 0x0d))
    ) return true;
    if (code === 0x7f) return true;
  }
  return UNSAFE_UNICODE_FORMAT_PATTERN.test(value);
}

function safeText(value, maximumCodePoints, maximumBytes, allowFormatting) {
  if (
    typeof value !== 'string'
    || value.length > maximumCodePoints * 2
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasControl(value, allowFormatting)
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || LOCAL_PATH_PATTERN.test(value.normalize('NFKC'))
    || CREDENTIAL_PATTERN.test(value.normalize('NFKC'))
  ) fail();
  return value;
}

function safeNullableText(value, maximumCodePoints, maximumBytes, allowFormatting) {
  if (value === null) return null;
  return safeText(value, maximumCodePoints, maximumBytes, allowFormatting);
}

function safeNullableApprovedPlanRef(value, assembledAtMs) {
  if (value === null) return null;
  exactObject(value, APPROVED_PLAN_REF_KEYS);
  const approvedAtMs = safeTimestamp(valueAt(value, 'approved_at_ms'));
  if (approvedAtMs > assembledAtMs) fail();
  return freezeDeep({
    plan_result_digest: safeDigest(valueAt(value, 'plan_result_digest')),
    conversation_head_digest: safeDigest(valueAt(value, 'conversation_head_digest')),
    approved_at_ms: approvedAtMs,
  });
}

function safeNullableCurrentResultRef(value, assembledAtMs) {
  if (value === null) return null;
  exactObject(value, CURRENT_RESULT_REF_KEYS);
  const recordedAtMs = safeTimestamp(valueAt(value, 'recorded_at_ms'));
  if (recordedAtMs > assembledAtMs) fail();
  return freezeDeep({
    result_kind: safeEnum(valueAt(value, 'result_kind'), CURRENT_RESULT_KINDS),
    result_digest: safeDigest(valueAt(value, 'result_digest')),
    recorded_at_ms: recordedAtMs,
  });
}

function denseArray(value, maximumItems, sanitizeItem) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximumItems) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    items.push(sanitizeItem(descriptor.value));
  }
  return freezeDeep(items);
}

function sanitizeSourceSummary(value) {
  exactObject(value, SOURCE_SUMMARY_KEYS);
  return freezeDeep({
    source_kind: safeEnum(valueAt(value, 'source_kind'), SOURCE_KINDS),
    source_digest: safeDigest(valueAt(value, 'source_digest')),
    summary: safeText(valueAt(value, 'summary'), 1_024, 4_096, true),
    priority: safeCount(valueAt(value, 'priority'), 0, 100),
  });
}

function sanitizeCompactionSummary(value, assembledAtMs) {
  exactObject(value, COMPACTION_SUMMARY_KEYS);
  const compactedAtMs = safeTimestamp(valueAt(value, 'compacted_at_ms'));
  if (compactedAtMs > assembledAtMs) fail();
  return freezeDeep({
    summary_digest: safeDigest(valueAt(value, 'summary_digest')),
    source_range_digest: safeDigest(valueAt(value, 'source_range_digest')),
    summary: safeText(valueAt(value, 'summary'), 1_024, 4_096, true),
    compacted_at_ms: compactedAtMs,
  });
}

function sanitizeHandoffPacket(value, assembledAtMs) {
  exactObject(value, HANDOFF_PACKET_KEYS);
  const adoptedAtMs = safeTimestamp(valueAt(value, 'adopted_at_ms'));
  if (adoptedAtMs > assembledAtMs) fail();
  return freezeDeep({
    packet_digest: safeDigest(valueAt(value, 'packet_digest')),
    summary: safeText(valueAt(value, 'summary'), 1_024, 4_096, true),
    adopted_at_ms: adoptedAtMs,
  });
}

function sanitizePermissionState(value) {
  exactObject(value, PERMISSION_STATE_KEYS);
  return freezeDeep({
    workspace_state: safeEnum(valueAt(value, 'workspace_state'), WORKSPACE_STATES),
    write_permission: safeEnum(valueAt(value, 'write_permission'), WRITE_PERMISSIONS),
  });
}

function sanitizeContextBudgetInput(value) {
  exactObject(value, CONTEXT_BUDGET_INPUT_KEYS);
  return freezeDeep({
    max_segments: safeCount(valueAt(value, 'max_segments'), 1, 16),
    max_prompt_bytes: safeCount(valueAt(value, 'max_prompt_bytes'), 512, 65_536),
    reserved_response_bytes: safeCount(valueAt(value, 'reserved_response_bytes'), 0, 65_536),
  });
}

function sourceRef(refKind, refDigest) {
  return freezeDeep({
    ref_kind: safeEnum(refKind, SOURCE_REF_KINDS),
    ref_digest: safeDigest(refDigest),
  });
}

function segment(segmentKind, source, text) {
  const safeSegmentKind = safeEnum(segmentKind, SEGMENT_KINDS);
  const safeSegmentText = safeText(text, 1_024, 4_096, true);
  return freezeDeep({
    segment_kind: safeSegmentKind,
    source_ref: source,
    text: safeSegmentText,
    byte_length: Buffer.byteLength(safeSegmentText, 'utf8'),
  });
}

function omitted(refKind, refDigest, reason) {
  return freezeDeep({
    ref_kind: safeEnum(refKind, SOURCE_REF_KINDS),
    ref_digest: safeDigest(refDigest),
    reason: safeEnum(reason, OMIT_REASONS),
  });
}

function requireSideEffectReady(assemblyPurpose, workingContextState, permissionState) {
  if (!SIDE_EFFECT_PURPOSES.includes(assemblyPurpose)) return false;
  if (!['ready', 'approved_plan_ready'].includes(workingContextState.state)) fail();
  if (permissionState.workspace_state !== 'bound' || permissionState.write_permission === 'denied') fail();
  return true;
}

function assertRefsMatchWorkingContext(workingContextState, approvedPlanRef, compactionSummaries, handoffPackets) {
  if (approvedPlanRef !== null) {
    if (
      workingContextState.approved_plan_ref === null
      || approvedPlanRef.plan_result_digest !== workingContextState.approved_plan_ref.plan_result_digest
      || approvedPlanRef.conversation_head_digest !== workingContextState.approved_plan_ref.conversation_head_digest
    ) fail();
  }
  const compactionRefKeys = new Set(workingContextState.compaction_refs.map((ref) => (
    `${ref.summary_digest}:${ref.source_range_digest}`
  )));
  for (const item of compactionSummaries) {
    if (!compactionRefKeys.has(`${item.summary_digest}:${item.source_range_digest}`)) fail();
  }
  const handoffRefKeys = new Set(workingContextState.handoff_refs.map((ref) => ref.packet_digest));
  for (const item of handoffPackets) {
    if (!handoffRefKeys.has(item.packet_digest)) fail();
  }
}

function workingContextConstraintText(workingContextState) {
  const lines = [];
  if (workingContextState.confirmed_constraints.length > 0) {
    lines.push(`Confirmed: ${workingContextState.confirmed_constraints.join('; ')}`);
  }
  if (workingContextState.rejected_constraints.length > 0) {
    lines.push(`Avoid: ${workingContextState.rejected_constraints.join('; ')}`);
  }
  if (workingContextState.open_questions.length > 0) {
    lines.push(`Open questions: ${workingContextState.open_questions.join('; ')}`);
  }
  return lines.length === 0 ? null : lines.join('\n');
}

function candidateSegments({
  latestUserMessage,
  workingContextState,
  approvedPlanRef,
  currentResultRef,
  sourceSummaries,
  compactionSummaries,
  handoffPackets,
}) {
  const items = [];
  if (latestUserMessage !== null) {
    items.push(segment(
      'latest_user_message',
      sourceRef('user_message', digest({ latest_user_message: latestUserMessage })),
      latestUserMessage,
    ));
  }
  if (workingContextState.objective_summary !== null) {
    items.push(segment(
      'working_context_objective',
      sourceRef('working_context_state', digest({ state_id: workingContextState.state_id, field: 'objective_summary' })),
      workingContextState.objective_summary,
    ));
  }
  const constraints = workingContextConstraintText(workingContextState);
  if (constraints !== null) {
    items.push(segment(
      'working_context_constraints',
      sourceRef('working_context_state', digest({ state_id: workingContextState.state_id, field: 'constraints' })),
      constraints,
    ));
  }
  if (approvedPlanRef !== null) {
    items.push(segment(
      'approved_plan',
      sourceRef('approved_plan', approvedPlanRef.plan_result_digest),
      'Use the currently approved plan reference for the next step.',
    ));
  }
  if (currentResultRef !== null) {
    items.push(segment(
      'current_result',
      sourceRef('current_result', currentResultRef.result_digest),
      `Current result available: ${currentResultRef.result_kind}.`,
    ));
  }
  for (const item of [...sourceSummaries].sort((left, right) => (
    right.priority - left.priority || left.source_digest.localeCompare(right.source_digest)
  ))) {
    items.push(segment(
      'selected_source_summary',
      sourceRef('selected_source', item.source_digest),
      item.summary,
    ));
  }
  for (const item of [...compactionSummaries].sort((left, right) => (
    right.compacted_at_ms - left.compacted_at_ms || left.summary_digest.localeCompare(right.summary_digest)
  ))) {
    items.push(segment(
      'compaction_summary',
      sourceRef('compaction_summary', item.summary_digest),
      item.summary,
    ));
  }
  for (const item of [...handoffPackets].sort((left, right) => (
    right.adopted_at_ms - left.adopted_at_ms || left.packet_digest.localeCompare(right.packet_digest)
  ))) {
    items.push(segment(
      'handoff_summary',
      sourceRef('handoff_packet', item.packet_digest),
      item.summary,
    ));
  }
  return items;
}

function applyBudget(segments, budget) {
  const selected = [];
  const omittedRefs = [];
  let usedPromptBytes = 0;
  for (const item of segments) {
    if (selected.length >= budget.max_segments) {
      omittedRefs.push(omitted(item.source_ref.ref_kind, item.source_ref.ref_digest, 'segment_limit'));
      continue;
    }
    if (usedPromptBytes + item.byte_length > budget.max_prompt_bytes) {
      omittedRefs.push(omitted(item.source_ref.ref_kind, item.source_ref.ref_digest, 'budget_exceeded'));
      continue;
    }
    selected.push(item);
    usedPromptBytes += item.byte_length;
  }
  return freezeDeep({
    model_context_segments: selected,
    omitted_refs: omittedRefs,
    context_budget: {
      max_segments: budget.max_segments,
      max_prompt_bytes: budget.max_prompt_bytes,
      used_prompt_bytes: usedPromptBytes,
      reserved_response_bytes: budget.reserved_response_bytes,
    },
  });
}

function runSnapshotRefsFromWorkingContextState(workingContextState) {
  return freezeDeep({
    working_context_state_id: workingContextState.state_id,
    working_context_state_updated_at_ms: workingContextState.updated_at_ms,
    compaction_refs: workingContextState.compaction_refs.map((ref) => ({
      summary_digest: ref.summary_digest,
      source_range_digest: ref.source_range_digest,
      compacted_at_ms: ref.compacted_at_ms,
    })),
    handoff_refs: workingContextState.handoff_refs.map((ref) => ({
      packet_digest: ref.packet_digest,
      inserted_at_ms: ref.inserted_at_ms,
      adopted_at_ms: ref.adopted_at_ms,
    })),
  });
}

function createBuilderContextAssembly(rawInput) {
  exactObject(rawInput, INPUT_KEYS);
  const assembledAtMs = safeTimestamp(valueAt(rawInput, 'assembled_at_ms'));
  const assemblyPurpose = safeEnum(valueAt(rawInput, 'assembly_purpose'), ASSEMBLY_PURPOSES);
  const projectId = safeProjectId(valueAt(rawInput, 'project_id'));
  const latestUserMessage = safeNullableText(valueAt(rawInput, 'latest_user_message'), 512, 2_048, true);
  const workingContextState = sanitizeBuilderWorkingContextState(valueAt(rawInput, 'working_context_state'));
  if (workingContextState.project_id !== projectId || workingContextState.updated_at_ms > assembledAtMs) fail();
  const approvedPlanRef = safeNullableApprovedPlanRef(valueAt(rawInput, 'approved_plan_ref'), assembledAtMs);
  const currentResultRef = safeNullableCurrentResultRef(valueAt(rawInput, 'current_result_ref'), assembledAtMs);
  const sourceSummaries = denseArray(valueAt(rawInput, 'selected_source_summaries'), 8, sanitizeSourceSummary);
  const compactionSummaries = denseArray(
    valueAt(rawInput, 'compaction_summaries'),
    4,
    (value) => sanitizeCompactionSummary(value, assembledAtMs),
  );
  const handoffPackets = denseArray(
    valueAt(rawInput, 'adopted_handoff_packets'),
    4,
    (value) => sanitizeHandoffPacket(value, assembledAtMs),
  );
  const permissionState = sanitizePermissionState(valueAt(rawInput, 'permission_state'));
  const budget = sanitizeContextBudgetInput(valueAt(rawInput, 'context_budget'));
  assertRefsMatchWorkingContext(workingContextState, approvedPlanRef, compactionSummaries, handoffPackets);
  const sideEffectReady = requireSideEffectReady(assemblyPurpose, workingContextState, permissionState);
  const candidates = candidateSegments({
    latestUserMessage,
    workingContextState,
    approvedPlanRef,
    currentResultRef,
    sourceSummaries,
    compactionSummaries,
    handoffPackets,
  });
  const budgeted = applyBudget(candidates, budget);
  const runSnapshotRefs = runSnapshotRefsFromWorkingContextState(workingContextState);
  const permissionGate = freezeDeep({
    workspace_state: permissionState.workspace_state,
    write_permission: permissionState.write_permission,
    side_effect_ready: sideEffectReady,
  });
  const body = freezeDeep({
    assembly_purpose: assemblyPurpose,
    project_id: projectId,
    working_context_state_id: workingContextState.state_id,
    working_context_state_status: workingContextState.state,
    model_context_segments: budgeted.model_context_segments,
    omitted_refs: budgeted.omitted_refs,
    context_budget: budgeted.context_budget,
    run_snapshot_refs: runSnapshotRefs,
    permission_gate: permissionGate,
    assembled_at_ms: assembledAtMs,
  });
  return freezeDeep({
    assembly_version: BUILDER_CONTEXT_ASSEMBLY_VERSION,
    assembly_id: digestId('builder-context-assembly', body),
    ...body,
    context_digest: digest(body),
    authority: { ...AUTHORITY },
  });
}

function sanitizeSourceRef(value) {
  exactObject(value, SOURCE_REF_KEYS);
  return freezeDeep({
    ref_kind: safeEnum(valueAt(value, 'ref_kind'), SOURCE_REF_KINDS),
    ref_digest: safeDigest(valueAt(value, 'ref_digest')),
  });
}

function sanitizeSegment(value) {
  exactObject(value, SEGMENT_KEYS);
  const text = safeText(valueAt(value, 'text'), 1_024, 4_096, true);
  const byteLength = safeCount(valueAt(value, 'byte_length'), 1, 4_096);
  if (Buffer.byteLength(text, 'utf8') !== byteLength) fail();
  return freezeDeep({
    segment_kind: safeEnum(valueAt(value, 'segment_kind'), SEGMENT_KINDS),
    source_ref: sanitizeSourceRef(valueAt(value, 'source_ref')),
    text,
    byte_length: byteLength,
  });
}

function sanitizeOmittedRef(value) {
  exactObject(value, OMITTED_REF_KEYS);
  return freezeDeep({
    ref_kind: safeEnum(valueAt(value, 'ref_kind'), SOURCE_REF_KINDS),
    ref_digest: safeDigest(valueAt(value, 'ref_digest')),
    reason: safeEnum(valueAt(value, 'reason'), OMIT_REASONS),
  });
}

function sanitizeContextBudget(value) {
  exactObject(value, CONTEXT_BUDGET_KEYS);
  const maxPromptBytes = safeCount(valueAt(value, 'max_prompt_bytes'), 512, 65_536);
  const usedPromptBytes = safeCount(valueAt(value, 'used_prompt_bytes'), 0, maxPromptBytes);
  return freezeDeep({
    max_segments: safeCount(valueAt(value, 'max_segments'), 1, 16),
    max_prompt_bytes: maxPromptBytes,
    used_prompt_bytes: usedPromptBytes,
    reserved_response_bytes: safeCount(valueAt(value, 'reserved_response_bytes'), 0, 65_536),
  });
}

function sanitizeCompactionRef(value) {
  exactObject(value, COMPACTION_REF_KEYS);
  return freezeDeep({
    summary_digest: safeDigest(valueAt(value, 'summary_digest')),
    source_range_digest: safeDigest(valueAt(value, 'source_range_digest')),
    compacted_at_ms: safeTimestamp(valueAt(value, 'compacted_at_ms')),
  });
}

function sanitizeHandoffRef(value) {
  exactObject(value, HANDOFF_REF_KEYS);
  const insertedAtMs = safeTimestamp(valueAt(value, 'inserted_at_ms'));
  const adoptedAtMs = safeTimestamp(valueAt(value, 'adopted_at_ms'));
  if (adoptedAtMs < insertedAtMs) fail();
  return freezeDeep({
    packet_digest: safeDigest(valueAt(value, 'packet_digest')),
    inserted_at_ms: insertedAtMs,
    adopted_at_ms: adoptedAtMs,
  });
}

function sanitizeRunSnapshotRefs(value, assembledAtMs) {
  exactObject(value, RUN_SNAPSHOT_REFS_KEYS);
  const updatedAtMs = safeTimestamp(valueAt(value, 'working_context_state_updated_at_ms'));
  if (updatedAtMs > assembledAtMs) fail();
  const compactionRefs = denseArray(valueAt(value, 'compaction_refs'), 4, sanitizeCompactionRef);
  const handoffRefs = denseArray(valueAt(value, 'handoff_refs'), 4, sanitizeHandoffRef);
  if (
    compactionRefs.some((ref) => ref.compacted_at_ms > assembledAtMs)
    || handoffRefs.some((ref) => ref.inserted_at_ms > assembledAtMs || ref.adopted_at_ms > assembledAtMs)
  ) fail();
  return freezeDeep({
    working_context_state_id: safeWorkingContextStateId(valueAt(value, 'working_context_state_id')),
    working_context_state_updated_at_ms: updatedAtMs,
    compaction_refs: compactionRefs,
    handoff_refs: handoffRefs,
  });
}

function sanitizePermissionGate(value) {
  exactObject(value, PERMISSION_GATE_KEYS);
  const sideEffectReady = valueAt(value, 'side_effect_ready');
  if (typeof sideEffectReady !== 'boolean') fail();
  return freezeDeep({
    workspace_state: safeEnum(valueAt(value, 'workspace_state'), WORKSPACE_STATES),
    write_permission: safeEnum(valueAt(value, 'write_permission'), WRITE_PERMISSIONS),
    side_effect_ready: sideEffectReady,
  });
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return { ...AUTHORITY };
}

function denseSanitizedArray(value, maximumItems, sanitizer) {
  return denseArray(value, maximumItems, sanitizer);
}

function sanitizeBuilderContextAssembly(value) {
  exactObject(value, ASSEMBLY_KEYS);
  if (valueAt(value, 'assembly_version') !== BUILDER_CONTEXT_ASSEMBLY_VERSION) fail();
  const assembledAtMs = safeTimestamp(valueAt(value, 'assembled_at_ms'));
  const body = freezeDeep({
    assembly_purpose: safeEnum(valueAt(value, 'assembly_purpose'), ASSEMBLY_PURPOSES),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    working_context_state_id: safeWorkingContextStateId(valueAt(value, 'working_context_state_id')),
    working_context_state_status: safeEnum(valueAt(value, 'working_context_state_status'), WORKING_CONTEXT_STATES),
    model_context_segments: denseSanitizedArray(valueAt(value, 'model_context_segments'), 16, sanitizeSegment),
    omitted_refs: denseSanitizedArray(valueAt(value, 'omitted_refs'), 16, sanitizeOmittedRef),
    context_budget: sanitizeContextBudget(valueAt(value, 'context_budget')),
    run_snapshot_refs: sanitizeRunSnapshotRefs(valueAt(value, 'run_snapshot_refs'), assembledAtMs),
    permission_gate: sanitizePermissionGate(valueAt(value, 'permission_gate')),
    assembled_at_ms: assembledAtMs,
  });
  if (
    valueAt(value, 'context_digest') !== digest(body)
    || valueAt(value, 'assembly_id') !== digestId('builder-context-assembly', body)
  ) fail();
  return freezeDeep({
    assembly_version: BUILDER_CONTEXT_ASSEMBLY_VERSION,
    assembly_id: valueAt(value, 'assembly_id'),
    ...body,
    context_digest: valueAt(value, 'context_digest'),
    authority: sanitizeAuthority(valueAt(value, 'authority')),
  });
}

module.exports = Object.freeze({
  BUILDER_CONTEXT_ASSEMBLY_VERSION,
  CONTEXT_ASSEMBLER_AUTHORITY: AUTHORITY,
  BuilderContextAssemblerError,
  createBuilderContextAssembly,
  sanitizeBuilderContextAssembly,
});
