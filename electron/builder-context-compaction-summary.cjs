'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_CONTEXT_COMPACTION_SUMMARY_VERSION = 'builder-context-compaction-summary.v1';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_PATTERN = /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;

const INPUT_KEYS = Object.freeze([
  'conversation_id',
  'task_address_id',
  'source_event_start_id',
  'source_event_end_id',
  'source_event_count',
  'token_budget_before',
  'token_budget_after',
  'summary',
  'durable_decisions',
  'unresolved_questions',
  'omitted_large_outputs',
  'source_refs',
  'created_at_ms',
]);
const SUMMARY_KEYS = Object.freeze([
  'summary_version',
  'summary_id',
  'conversation_id',
  'task_address_id',
  'source_event_start_id',
  'source_event_end_id',
  'source_event_count',
  'source_range_digest',
  'token_budget_before',
  'token_budget_after',
  'summary',
  'durable_decisions',
  'unresolved_questions',
  'omitted_large_outputs',
  'source_refs',
  'digest',
  'created_at_ms',
  'authority',
]);
const OMITTED_OUTPUT_KEYS = Object.freeze(['source_kind', 'source_digest', 'reason']);
const SOURCE_REF_KEYS = Object.freeze(['source_kind', 'source_digest']);
const AUTHORITY_KEYS = Object.freeze([
  'compaction_authority',
  'context_read',
  'sqlite_write',
  'conversation_delete',
  'renderer_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'permission_grant',
  'readiness_authority',
]);
const SOURCE_KINDS = Object.freeze([
  'user_message',
  'assistant_message',
  'run_result',
  'tool_output',
  'task_capsule_update',
  'approved_plan',
]);
const OMITTED_OUTPUT_KINDS = Object.freeze(['tool_output', 'provider_output', 'source_excerpt', 'diff_excerpt']);
const AUTHORITY = Object.freeze({
  compaction_authority: 'main_context_compaction_summary_contract_v1',
  context_read: 'provided_by_caller',
  sqlite_write: 'not_performed',
  conversation_delete: 'not_performed',
  renderer_authority: 'not_present',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  permission_grant: 'not_performed',
  readiness_authority: 'not_authoritative_for_readiness',
});

const ERROR_MESSAGE = 'Builder context compaction summary could not be verified.';

class BuilderContextCompactionSummaryError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderContextCompactionSummaryError';
    this.code = 'builder_context_compaction_summary_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderContextCompactionSummaryError();
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

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 96);
}

function safeTaskAddressId(value) {
  return safePattern(value, TASK_ADDRESS_ID_PATTERN, 96);
}

function safeEventId(value) {
  return safePattern(value, EVENT_ID_PATTERN, 96);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 80);
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

function safeTextArray(value, maximumItems, maximumCodePoints, maximumBytes) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximumItems) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const items = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const item = safeText(descriptor.value, maximumCodePoints, maximumBytes, true);
    if (seen.has(item)) fail();
    seen.add(item);
    items.push(item);
  }
  return freezeDeep(items);
}

function sanitizeOmittedOutput(value) {
  exactObject(value, OMITTED_OUTPUT_KEYS);
  return freezeDeep({
    source_kind: safeEnum(valueAt(value, 'source_kind'), OMITTED_OUTPUT_KINDS),
    source_digest: safeDigest(valueAt(value, 'source_digest')),
    reason: safeText(valueAt(value, 'reason'), 240, 960, false),
  });
}

function sanitizeOmittedOutputs(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 16) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const items = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const item = sanitizeOmittedOutput(descriptor.value);
    const key = `${item.source_kind}:${item.source_digest}`;
    if (seen.has(key)) fail();
    seen.add(key);
    items.push(item);
  }
  return freezeDeep(items);
}

function sanitizeSourceRef(value) {
  exactObject(value, SOURCE_REF_KEYS);
  return freezeDeep({
    source_kind: safeEnum(valueAt(value, 'source_kind'), SOURCE_KINDS),
    source_digest: safeDigest(valueAt(value, 'source_digest')),
  });
}

function sanitizeSourceRefs(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length < 1 || value.length > 32) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const refs = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const ref = sanitizeSourceRef(descriptor.value);
    const key = `${ref.source_kind}:${ref.source_digest}`;
    if (seen.has(key)) fail();
    seen.add(key);
    refs.push(ref);
  }
  return freezeDeep(refs);
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return { ...AUTHORITY };
}

function buildBody(rawInput) {
  exactObject(rawInput, INPUT_KEYS);
  const tokenBudgetBefore = safeCount(valueAt(rawInput, 'token_budget_before'), 1, 10_000_000);
  const tokenBudgetAfter = safeCount(valueAt(rawInput, 'token_budget_after'), 1, 10_000_000);
  if (tokenBudgetAfter >= tokenBudgetBefore) fail();
  const sourceEventCount = safeCount(valueAt(rawInput, 'source_event_count'), 1, 10_000);
  return freezeDeep({
    conversation_id: safeConversationId(valueAt(rawInput, 'conversation_id')),
    task_address_id: safeTaskAddressId(valueAt(rawInput, 'task_address_id')),
    source_event_start_id: safeEventId(valueAt(rawInput, 'source_event_start_id')),
    source_event_end_id: safeEventId(valueAt(rawInput, 'source_event_end_id')),
    source_event_count: sourceEventCount,
    source_range_digest: digest({
      conversation_id: valueAt(rawInput, 'conversation_id'),
      task_address_id: valueAt(rawInput, 'task_address_id'),
      source_event_start_id: valueAt(rawInput, 'source_event_start_id'),
      source_event_end_id: valueAt(rawInput, 'source_event_end_id'),
      source_event_count: sourceEventCount,
    }),
    token_budget_before: tokenBudgetBefore,
    token_budget_after: tokenBudgetAfter,
    summary: safeText(valueAt(rawInput, 'summary'), 4_096, 16_384, true),
    durable_decisions: safeTextArray(valueAt(rawInput, 'durable_decisions'), 24, 512, 2_048),
    unresolved_questions: safeTextArray(valueAt(rawInput, 'unresolved_questions'), 16, 512, 2_048),
    omitted_large_outputs: sanitizeOmittedOutputs(valueAt(rawInput, 'omitted_large_outputs')),
    source_refs: sanitizeSourceRefs(valueAt(rawInput, 'source_refs')),
    created_at_ms: safeTimestamp(valueAt(rawInput, 'created_at_ms')),
    authority: { ...AUTHORITY },
  });
}

function createBuilderContextCompactionSummary(rawInput) {
  const body = buildBody(rawInput);
  return freezeDeep({
    summary_version: BUILDER_CONTEXT_COMPACTION_SUMMARY_VERSION,
    summary_id: digestId('builder-context-compaction-summary', body),
    ...body,
    digest: digest(body),
  });
}

function sanitizeBuilderContextCompactionSummary(value) {
  exactObject(value, SUMMARY_KEYS);
  if (valueAt(value, 'summary_version') !== BUILDER_CONTEXT_COMPACTION_SUMMARY_VERSION) fail();
  const body = freezeDeep({
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    task_address_id: safeTaskAddressId(valueAt(value, 'task_address_id')),
    source_event_start_id: safeEventId(valueAt(value, 'source_event_start_id')),
    source_event_end_id: safeEventId(valueAt(value, 'source_event_end_id')),
    source_event_count: safeCount(valueAt(value, 'source_event_count'), 1, 10_000),
    source_range_digest: safeDigest(valueAt(value, 'source_range_digest')),
    token_budget_before: safeCount(valueAt(value, 'token_budget_before'), 1, 10_000_000),
    token_budget_after: safeCount(valueAt(value, 'token_budget_after'), 1, 10_000_000),
    summary: safeText(valueAt(value, 'summary'), 4_096, 16_384, true),
    durable_decisions: safeTextArray(valueAt(value, 'durable_decisions'), 24, 512, 2_048),
    unresolved_questions: safeTextArray(valueAt(value, 'unresolved_questions'), 16, 512, 2_048),
    omitted_large_outputs: sanitizeOmittedOutputs(valueAt(value, 'omitted_large_outputs')),
    source_refs: sanitizeSourceRefs(valueAt(value, 'source_refs')),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
    authority: sanitizeAuthority(valueAt(value, 'authority')),
  });
  if (body.token_budget_after >= body.token_budget_before) fail();
  const expectedRangeDigest = digest({
    conversation_id: body.conversation_id,
    task_address_id: body.task_address_id,
    source_event_start_id: body.source_event_start_id,
    source_event_end_id: body.source_event_end_id,
    source_event_count: body.source_event_count,
  });
  if (
    body.source_range_digest !== expectedRangeDigest
    || valueAt(value, 'digest') !== digest(body)
    || valueAt(value, 'summary_id') !== digestId('builder-context-compaction-summary', body)
  ) fail();
  return freezeDeep({
    summary_version: BUILDER_CONTEXT_COMPACTION_SUMMARY_VERSION,
    summary_id: valueAt(value, 'summary_id'),
    ...body,
    digest: valueAt(value, 'digest'),
  });
}

module.exports = Object.freeze({
  BUILDER_CONTEXT_COMPACTION_SUMMARY_VERSION,
  CONTEXT_COMPACTION_SUMMARY_AUTHORITY: AUTHORITY,
  BuilderContextCompactionSummaryError,
  createBuilderContextCompactionSummary,
  sanitizeBuilderContextCompactionSummary,
});
