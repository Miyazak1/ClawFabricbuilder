'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDelegationResultParentMaterializationError,
  sanitizeBuilderAgentDelegationResultParentMaterializationRecord,
} = require('./builder-agent-delegation-result-parent-materialization.cjs');

const BUILDER_AGENT_PARENT_TASK_CONTEXT_PROJECTION_VERSION =
  'builder-agent-parent-task-context-projection.v1';
const BUILDER_AGENT_PARENT_TASK_CONTEXT_PROJECTION_ID_PREFIX =
  'builder-agent-parent-task-context-projection:';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const DELEGATION_ID_PATTERN = /^builder-agent-delegation:[0-9a-f]{64}$/u;
const DELEGATION_RESULT_ID_PATTERN = /^builder-agent-delegation-result:[0-9a-f]{64}$/u;
const DELEGATION_RESULT_ADMISSION_ID_PATTERN =
  /^builder-agent-delegation-result-admission:[0-9a-f]{64}$/u;
const DELEGATION_RESULT_REVIEW_ID_PATTERN =
  /^builder-agent-delegation-result-review:[0-9a-f]{64}$/u;
const ELIGIBILITY_ID_PATTERN =
  /^builder-agent-delegation-result-parent-materialization-eligibility:[0-9a-f]{64}$/u;
const MATERIALIZATION_ID_PATTERN =
  /^builder-agent-delegation-result-parent-materialization:[0-9a-f]{64}$/u;
const PROJECTION_ID_PATTERN =
  /^builder-agent-parent-task-context-projection:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const INPUT_KEYS = Object.freeze([
  'owner_id',
  'project_id',
  'parent_task_id',
  'materializations',
  'created_at_ms',
]);
const MATERIALIZATION_ENTRY_KEYS = Object.freeze([
  'delegation',
  'result',
  'admission',
  'review',
  'eligibility',
  'materialization',
]);
const REF_KEYS = Object.freeze([
  'delegation_result_parent_materialization_id',
  'delegation_result_parent_materialization_eligibility_id',
  'delegation_result_review_id',
  'delegation_result_admission_id',
  'delegation_result_id',
  'delegation_id',
  'child_conversation_id',
  'child_task_id',
  'child_run_id',
  'to_agent_id',
  'to_agent_version_id',
  'result_status',
  'result_summary_code',
  'decision',
  'eligibility_status',
  'parent_context_status',
  'materialization_summary_code',
  'materialized_at_ms',
]);
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'projection_id',
  'owner_id',
  'project_id',
  'parent_task_id',
  'context_kind',
  'materialized_child_result_refs',
  'available_materialization_count',
  'included_materialization_count',
  'truncated',
  'created_at_ms',
  'context_digest',
  'authority',
]);
const PROJECTION_BODY_KEYS = Object.freeze([
  'projection_version',
  'owner_id',
  'project_id',
  'parent_task_id',
  'context_kind',
  'materialized_child_result_refs',
  'available_materialization_count',
  'included_materialization_count',
  'truncated',
  'created_at_ms',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'parent_task_context_authority',
  'delegation_result_parent_materialization_authority',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'model_dispatch',
  'tool_dispatch',
  'permission_grant_authority',
  'credential_storage',
  'source_access',
  'source_read',
  'source_write',
  'process_run',
  'network_access',
  'revision_authority',
  'review_row_authority',
  'artifact_authority',
  'parent_source_mutation_authority',
]);
const MAX_MATERIALIZATION_INPUTS = 128;
const MAX_INCLUDED_REFS = 32;
const CONTEXT_KIND = 'agent_parent_task_context_from_reviewed_child_results';
const AUTHORITY = Object.freeze({
  projection_authority: 'main_agent_parent_task_context_projection_v1',
  parent_task_context_authority: 'local_parent_task_context_projection_only',
  delegation_result_parent_materialization_authority:
    'main_agent_delegation_result_parent_materialization_receipts',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: false,
  model_dispatch: false,
  tool_dispatch: false,
  permission_grant_authority: false,
  credential_storage: 'not_present',
  source_access: 'not_present',
  source_read: 'not_present',
  source_write: 'not_present',
  process_run: false,
  network_access: false,
  revision_authority: false,
  review_row_authority: false,
  artifact_authority: false,
  parent_source_mutation_authority: false,
});

class BuilderAgentParentTaskContextProjectionError extends Error {
  constructor() {
    super('Builder agent parent task context projection could not be verified.');
    this.name = 'BuilderAgentParentTaskContextProjectionError';
    this.code = 'builder_agent_parent_task_context_projection_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentParentTaskContextProjectionError();
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
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
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

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isPlainObject(value)) fail();
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function denseArray(value, maxLength) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maxLength
  ) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => typeof key === 'symbol')) fail();
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    items.push(descriptor.value);
  }
  return items;
}

function safeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(value, key) !== AUTHORITY[key]) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function safeRef(value) {
  const source = exactObject(value, REF_KEYS);
  return freezeDeep({
    delegation_result_parent_materialization_id: safePattern(
      valueAt(source, 'delegation_result_parent_materialization_id'),
      MATERIALIZATION_ID_PATTERN,
    ),
    delegation_result_parent_materialization_eligibility_id: safePattern(
      valueAt(source, 'delegation_result_parent_materialization_eligibility_id'),
      ELIGIBILITY_ID_PATTERN,
    ),
    delegation_result_review_id: safePattern(
      valueAt(source, 'delegation_result_review_id'),
      DELEGATION_RESULT_REVIEW_ID_PATTERN,
    ),
    delegation_result_admission_id: safePattern(
      valueAt(source, 'delegation_result_admission_id'),
      DELEGATION_RESULT_ADMISSION_ID_PATTERN,
    ),
    delegation_result_id: safePattern(valueAt(source, 'delegation_result_id'), DELEGATION_RESULT_ID_PATTERN),
    delegation_id: safePattern(valueAt(source, 'delegation_id'), DELEGATION_ID_PATTERN),
    child_conversation_id: safePattern(valueAt(source, 'child_conversation_id'), CONVERSATION_ID_PATTERN),
    child_task_id: safePattern(valueAt(source, 'child_task_id'), TASK_ID_PATTERN),
    child_run_id: safePattern(valueAt(source, 'child_run_id'), RUN_ID_PATTERN),
    to_agent_id: safePattern(valueAt(source, 'to_agent_id'), AGENT_ID_PATTERN),
    to_agent_version_id: safePattern(valueAt(source, 'to_agent_version_id'), AGENT_VERSION_ID_PATTERN),
    result_status: safeFixed(valueAt(source, 'result_status'), 'proposed'),
    result_summary_code: safeFixed(
      valueAt(source, 'result_summary_code'),
      'delegated_child_result_ready_for_parent_review',
    ),
    decision: safeFixed(valueAt(source, 'decision'), 'approved_for_parent_materialization'),
    eligibility_status: safeFixed(
      valueAt(source, 'eligibility_status'),
      'eligible_for_parent_materialization_gate',
    ),
    parent_context_status: safeFixed(
      valueAt(source, 'parent_context_status'),
      'materialized_as_parent_task_context_receipt',
    ),
    materialization_summary_code: safeFixed(
      valueAt(source, 'materialization_summary_code'),
      'delegated_child_result_materialized_as_parent_context_receipt',
    ),
    materialized_at_ms: safeTimestamp(valueAt(source, 'materialized_at_ms')),
  });
}

function safeFixed(value, expected) {
  if (value !== expected) fail();
  return expected;
}

function refFromEntry(rawEntry, expected) {
  const entry = exactObject(rawEntry, MATERIALIZATION_ENTRY_KEYS);
  const delegation = valueAt(entry, 'delegation');
  const result = valueAt(entry, 'result');
  const admission = valueAt(entry, 'admission');
  const review = valueAt(entry, 'review');
  const eligibility = valueAt(entry, 'eligibility');
  let materialization;
  try {
    materialization = sanitizeBuilderAgentDelegationResultParentMaterializationRecord(
      valueAt(entry, 'materialization'),
      eligibility,
      review,
      admission,
      result,
      delegation,
    );
  } catch (error) {
    if (error instanceof BuilderAgentDelegationResultParentMaterializationError) fail();
    throw error;
  }
  if (
    materialization.owner_id !== expected.owner_id
    || materialization.project_id !== expected.project_id
    || materialization.parent_task_id !== expected.parent_task_id
  ) fail();
  return freezeDeep({
    delegation_result_parent_materialization_id:
      materialization.delegation_result_parent_materialization_id,
    delegation_result_parent_materialization_eligibility_id:
      materialization.delegation_result_parent_materialization_eligibility_id,
    delegation_result_review_id: materialization.delegation_result_review_id,
    delegation_result_admission_id: materialization.delegation_result_admission_id,
    delegation_result_id: materialization.delegation_result_id,
    delegation_id: materialization.delegation_id,
    child_conversation_id: materialization.child_conversation_id,
    child_task_id: materialization.child_task_id,
    child_run_id: materialization.child_run_id,
    to_agent_id: materialization.to_agent_id,
    to_agent_version_id: materialization.to_agent_version_id,
    result_status: materialization.result.status,
    result_summary_code: materialization.result.summary_code,
    decision: materialization.decision,
    eligibility_status: materialization.eligibility_status,
    parent_context_status: materialization.parent_context_status,
    materialization_summary_code: materialization.materialization_summary_code,
    materialized_at_ms: materialization.materialized_at_ms,
  });
}

function sortRefs(refs) {
  return refs.slice().sort((left, right) => {
    if (left.materialized_at_ms !== right.materialized_at_ms) {
      return left.materialized_at_ms - right.materialized_at_ms;
    }
    return left.delegation_result_parent_materialization_id.localeCompare(
      right.delegation_result_parent_materialization_id,
    );
  });
}

function validateProjectionRefs(refs) {
  const seenMaterializations = new Set();
  const seenEligibilities = new Set();
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index];
    if (
      seenMaterializations.has(ref.delegation_result_parent_materialization_id)
      || seenEligibilities.has(ref.delegation_result_parent_materialization_eligibility_id)
    ) fail();
    seenMaterializations.add(ref.delegation_result_parent_materialization_id);
    seenEligibilities.add(ref.delegation_result_parent_materialization_eligibility_id);
    if (index > 0) {
      const previous = refs[index - 1];
      if (
        previous.materialized_at_ms > ref.materialized_at_ms
        || (
          previous.materialized_at_ms === ref.materialized_at_ms
          && previous.delegation_result_parent_materialization_id.localeCompare(
            ref.delegation_result_parent_materialization_id,
          ) > 0
        )
      ) fail();
    }
  }
  return freezeDeep(refs);
}

function normalizeRefs(rawMaterializations, expected) {
  const rawItems = denseArray(rawMaterializations, MAX_MATERIALIZATION_INPUTS);
  const refs = sortRefs(rawItems.map((entry) => refFromEntry(entry, expected)));
  return validateProjectionRefs(refs);
}

function projectionBody(input, refs, includedRefs) {
  return freezeDeep({
    projection_version: BUILDER_AGENT_PARENT_TASK_CONTEXT_PROJECTION_VERSION,
    owner_id: input.owner_id,
    project_id: input.project_id,
    parent_task_id: input.parent_task_id,
    context_kind: CONTEXT_KIND,
    materialized_child_result_refs: includedRefs,
    available_materialization_count: refs.length,
    included_materialization_count: includedRefs.length,
    truncated: refs.length > includedRefs.length,
    created_at_ms: input.created_at_ms,
    authority: freezeDeep({ ...AUTHORITY }),
  });
}

function projectionIdFor(contextDigest) {
  return `${BUILDER_AGENT_PARENT_TASK_CONTEXT_PROJECTION_ID_PREFIX}${contextDigest.slice('sha256:'.length)}`;
}

function createBuilderAgentParentTaskContextProjection(rawInput) {
  try {
    const source = exactObject(rawInput, INPUT_KEYS);
    const input = {
      owner_id: safePattern(valueAt(source, 'owner_id'), OWNER_ID_PATTERN),
      project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
      parent_task_id: safePattern(valueAt(source, 'parent_task_id'), TASK_ID_PATTERN),
      created_at_ms: safeTimestamp(valueAt(source, 'created_at_ms')),
    };
    const refs = normalizeRefs(valueAt(source, 'materializations'), input);
    const includedRefs = freezeDeep(refs.slice(0, MAX_INCLUDED_REFS));
    const body = projectionBody(input, refs, includedRefs);
    const contextDigest = sha256Canonical(body);
    return freezeDeep({
      ...body,
      projection_id: projectionIdFor(contextDigest),
      context_digest: contextDigest,
    });
  } catch (error) {
    if (error instanceof BuilderAgentParentTaskContextProjectionError) fail();
    throw error;
  }
}

function sanitizeBuilderAgentParentTaskContextProjection(rawProjection, expected = null) {
  try {
    const source = exactObject(rawProjection, PROJECTION_KEYS);
    const body = {};
    for (const key of PROJECTION_BODY_KEYS) body[key] = valueAt(source, key);
    const projectionVersion = safeFixed(
      body.projection_version,
      BUILDER_AGENT_PARENT_TASK_CONTEXT_PROJECTION_VERSION,
    );
    const ownerId = safePattern(body.owner_id, OWNER_ID_PATTERN);
    const projectId = safePattern(body.project_id, PROJECT_ID_PATTERN);
    const parentTaskId = safePattern(body.parent_task_id, TASK_ID_PATTERN);
    if (expected !== null) {
      exactObject(expected, ['owner_id', 'project_id', 'parent_task_id']);
      if (
        ownerId !== safePattern(valueAt(expected, 'owner_id'), OWNER_ID_PATTERN)
        || projectId !== safePattern(valueAt(expected, 'project_id'), PROJECT_ID_PATTERN)
        || parentTaskId !== safePattern(valueAt(expected, 'parent_task_id'), TASK_ID_PATTERN)
      ) fail();
    }
    const contextKind = safeFixed(body.context_kind, CONTEXT_KIND);
    const refs = validateProjectionRefs(
      denseArray(body.materialized_child_result_refs, MAX_INCLUDED_REFS).map(safeRef),
    );
    const availableCount = valueAt(source, 'available_materialization_count');
    const includedCount = valueAt(source, 'included_materialization_count');
    if (
      !Number.isSafeInteger(availableCount)
      || !Number.isSafeInteger(includedCount)
      || availableCount < includedCount
      || includedCount !== refs.length
      || availableCount > MAX_MATERIALIZATION_INPUTS
    ) fail();
    const truncated = valueAt(source, 'truncated');
    if (typeof truncated !== 'boolean' || truncated !== (availableCount > includedCount)) fail();
    const normalizedBody = freezeDeep({
      projection_version: projectionVersion,
      owner_id: ownerId,
      project_id: projectId,
      parent_task_id: parentTaskId,
      context_kind: contextKind,
      materialized_child_result_refs: freezeDeep(refs),
      available_materialization_count: availableCount,
      included_materialization_count: includedCount,
      truncated,
      created_at_ms: safeTimestamp(body.created_at_ms),
      authority: safeAuthority(body.authority),
    });
    const contextDigest = safePattern(valueAt(source, 'context_digest'), DIGEST_PATTERN);
    const projectionId = safePattern(valueAt(source, 'projection_id'), PROJECTION_ID_PATTERN);
    if (contextDigest !== sha256Canonical(normalizedBody) || projectionId !== projectionIdFor(contextDigest)) {
      fail();
    }
    return freezeDeep({
      ...normalizedBody,
      projection_id: projectionId,
      context_digest: contextDigest,
    });
  } catch (error) {
    if (error instanceof BuilderAgentParentTaskContextProjectionError) fail();
    throw error;
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_PARENT_TASK_CONTEXT_PROJECTION_VERSION,
  BuilderAgentParentTaskContextProjectionError,
  createBuilderAgentParentTaskContextProjection,
  sanitizeBuilderAgentParentTaskContextProjection,
});
