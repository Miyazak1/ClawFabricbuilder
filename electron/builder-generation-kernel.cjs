'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderCodeChangeKernelError,
  MAX_CODE_CHANGE_CANDIDATE_UTF8_BYTES,
  createBuilderCodeChangeCandidate,
} = require('./builder-code-change-kernel.cjs');
const {
  BuilderProjectSourceTreeError,
  MAX_SOURCE_TREE_UTF8_BYTES,
  createBuilderProjectSourceTree,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  BuilderPlanProposalRecordError,
  createBuilderPlanProposalRecord,
  sanitizeBuilderPlanProposalSourceContextResult,
} = require('./builder-plan-proposal-records.cjs');
const {
  isPublicBuilderRouteDecisionSignal,
} = require('./builder-route-decision-signals.cjs');

const BUILDER_CODE_PROJECT_PROMPT_VERSION = 'builder-code-project.v3';
const BUILDER_PLAN_PROJECT_PROMPT_VERSION = 'builder-project-plan.v1';
const BUILDER_GENERATION_REQUEST_PROTOCOL = 'builder-generation-request.v2';
const BUILDER_GENERATION_RESULT_PROTOCOL = 'builder-generation-result.v2';
const BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION = 'builder-generation-prompt-descriptor.v2';
const BUILDER_GENERATED_OPERATIONS_KIND = 'builder_code_change_operations';
const BUILDER_GENERATED_EXPLANATION_KIND = 'builder_conversation_explanation';
const BUILDER_GENERATED_PLAN_KIND = 'builder_project_plan_proposal';

const MAX_INSTRUCTION_CODE_POINTS = 4000;
const MAX_INSTRUCTION_UTF8_BYTES = 16 * 1024;
const MAX_EXPLANATION_CODE_POINTS = 4000;
const MAX_EXPLANATION_UTF8_BYTES = 16 * 1024;
const MAX_PLAN_STEP_COUNT = 12;
const MAX_PLAN_STEP_TITLE_CODE_POINTS = 120;
const MAX_PLAN_STEP_TITLE_UTF8_BYTES = 512;
const MAX_PLAN_STEP_TEXT_CODE_POINTS = 360;
const MAX_PLAN_STEP_TEXT_UTF8_BYTES = 1536;
const MAX_GENERATED_TEXT_BYTES = MAX_CODE_CHANGE_CANDIDATE_UTF8_BYTES;
const MAX_PROMPT_DESCRIPTOR_BYTES = MAX_SOURCE_TREE_UTF8_BYTES + (96 * 1024);
const MAX_CONVERSATION_EVENTS_FOR_PROMPT = 128;
const MAX_CONVERSATION_BRIEF_ENTRIES = 8;
const MAX_CONVERSATION_BRIEF_TEXT_CODE_POINTS = 1200;
const MAX_CONVERSATION_BRIEF_TEXT_UTF8_BYTES = 4096;
const CONVERSATION_BRIEF_CONTEXT_VERSION = 'builder-conversation-brief.v3';
const CONVERSATION_BRIEF_SELECTION = 'recent_prior_messages_latest_plan_and_working_brief';
const BUILD_CONTEXT_SNAPSHOT_VERSION = 'builder-build-context-snapshot.v1';

const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_ASSIGNMENT_PATTERN = /["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S/iu;
const AUTHORIZATION_VALUE_PATTERN = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}/iu;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^\s/:@]+:[^\s/@]+@/iu;
const COMMON_SECRET_VALUE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/u;
const WORKING_BRIEF_USER_CONTEXT_PATTERN =
  /(?:确认|想要|希望|需要|做一个|做个|创建|生成|实现|修改|页面|网页|网站|应用|功能|布局|组件|作品集|仪表盘|\b(?:build|create|implement|make|page|site|app|feature|layout|component|dashboard|portfolio)\b)/iu;
const WORKING_BRIEF_CONFIRMED_USER_PATTERN =
  /(?:(?:确认|决定|确定|需求|目标|要做|要实现|准备做|准备实现|想要|希望|需要).*(?:做一个|做个|创建|生成|实现|修改|页面|网页|网站|应用|功能|布局|组件|作品集|仪表盘)|^(?:(?:我|我们)?(?:想|想要|要|希望|需要|打算|准备|计划|考虑))(?!\s*(?:先)?(?:知道|了解|问|问一下|看看|看一下|搞清楚|确认一下|解释|说明|分析|对比))[^?？]*(?:做|创建|生成|实现|设计|开发|搭建|修改|页面|网页|网站|应用|功能|布局|组件|登录页|仪表盘|看板|作品集|3d|ui)|(?:confirmed|decided|goal|requirements?|want|would like|need|hope|plan|intend).*\b(?:build|implement|create|make|modify|page|site|app|feature|layout|component|dashboard|portfolio)\b)/iu;
const WORKING_BRIEF_ASSISTANT_PROPOSAL_PATTERN =
  /(?:(?:方案是|计划是|建议|可以先|我会|我将|接下来会|可以按).*(?:做一个|做个|创建|生成|实现|修改|页面|网页|网站|应用|功能|布局|组件|作品集|仪表盘)|(?:plan is|proposal is|approach is|recommend|suggest|i will|i would|next i will|we can).*\b(?:build|implement|create|make|modify|page|site|app|feature|layout|component|dashboard|portfolio)\b)/iu;

const REQUEST_KEYS = Object.freeze(['version', 'instruction', 'existing_project_id', 'request_digest']);
const REQUEST_INPUT_KEYS = Object.freeze(['instruction', 'existing_project_id']);
const PROMPT_INPUT_KEYS = Object.freeze(['request', 'base_source_tree', 'conversation_events']);
const PLAN_PROMPT_INPUT_KEYS = Object.freeze(['request', 'source_context_result']);
const RESULT_INPUT_KEYS = Object.freeze([
  'request',
  'base_revision_evidence',
  'base_source_tree',
  'conversation_events',
  'turn_id',
  'run_id',
  'generated_text',
]);
const DRAFT_CONTINUATION_RESULT_INPUT_KEYS = Object.freeze([
  'request',
  'prompt_base_source_tree',
  'candidate_base_revision_evidence',
  'candidate_base_source_tree',
  'conversation_events',
  'turn_id',
  'run_id',
  'generated_text',
]);
const PLAN_RESULT_INPUT_KEYS = Object.freeze(['request', 'source_context_result', 'proposed_at_ms', 'generated_text']);
const PROVIDER_OUTPUT_KEYS = Object.freeze(['kind', 'title', 'summary', 'operations']);
const EXPLANATION_OUTPUT_KEYS = Object.freeze(['kind', 'title', 'summary', 'explanation']);
const PLAN_OUTPUT_KEYS = Object.freeze(['kind', 'title', 'summary', 'steps']);
const RAW_OPERATION_KEYS = Object.freeze(['operation', 'path', 'content']);
const RAW_PLAN_STEP_KEYS = Object.freeze(['title', 'purpose', 'expected_change']);
const PLAN_PROMPT_PRIVATE_CONTEXT_KEYS = Object.freeze(['context_version', 'files']);
const PLAN_PROMPT_PRIVATE_FILE_KEYS = Object.freeze(['path', 'entry_kind', 'content', 'content_digest', 'content_bytes']);
const PATH_FOLD_KEY_LOCALE = 'en-US';

const JSON_OUTPUT_EXAMPLE = JSON.stringify({
  kind: BUILDER_GENERATED_OPERATIONS_KIND,
  title: 'Focus timer',
  summary: 'A calm timer with one clear action.',
  operations: [
    { operation: 'upsert', path: 'index.html', content: '<main><h1>Focus timer</h1></main>\n' },
    { operation: 'upsert', path: 'src/app.js', content: 'console.log("ready");\n' },
  ],
});
const EXPLANATION_OUTPUT_EXAMPLE = JSON.stringify({
  kind: BUILDER_GENERATED_EXPLANATION_KIND,
  title: 'Current project',
  summary: 'Explains the saved project without changing files.',
  explanation: 'The project is a small local app. No source files were changed by this answer.',
});
const PLAN_OUTPUT_EXAMPLE = JSON.stringify({
  kind: BUILDER_GENERATED_PLAN_KIND,
  title: 'Review the change plan',
  summary: 'A short plan for the requested project update.',
  steps: [
    {
      title: 'Inspect the current project shape',
      purpose: 'Understand the files that need to change.',
      expected_change: 'No source files change during planning.',
    },
    {
      title: 'Prepare the implementation pass',
      purpose: 'Keep the next edit bounded and reviewable.',
      expected_change: 'A later approved step can create the draft.',
    },
  ],
});

const CODE_CHANGE_SYSTEM_INSTRUCTION = [
  'Create or revise one small software project.',
  'Return one JSON object only, with no markdown fence or surrounding text.',
  'Use exactly the keys kind, title, summary, and operations.',
  `Set kind to ${BUILDER_GENERATED_OPERATIONS_KIND}.`,
  `Example JSON object: ${JSON_OUTPUT_EXAMPLE}`,
  'operations is an array of source changes. Each operation uses exactly operation, path, and content.',
  'operation must be upsert or delete. For delete, content must be null. For upsert, content is the complete file content.',
  'Use ordinary relative project paths. Do not include absolute paths or local machine paths.',
  'You may generate general source code in any language when it fits the request, including imports, process APIs, networking code, tests, or configuration files.',
  'Do not claim the code was executed, previewed, saved, committed, or reviewed.',
  'Do not add fields for host identities, digests, receipts, admissions, timestamps, credentials, or runtime claims.',
  'Do not include credentials, API keys, private keys, bearer tokens, or secrets.',
  'Prefer a small coherent change over a broad scaffold when the request is ambiguous.',
  'Use conversation_brief as context. If it contains latest_plan, treat its state as meaningful: approved plans may guide implementation, proposed plans are not approval to change files, and rejected plans must not be implemented.',
  'If the current instruction is a short contextual approval, use conversation_brief.working_brief as the implementation target; working_brief is requirements context, not execution, save, review, or runtime evidence.',
].join('\n');

const EXPLANATION_SYSTEM_INSTRUCTION = [
  'Answer one bounded question about the current local software project.',
  'Return one JSON object only, with no markdown fence or surrounding text.',
  'Use exactly the keys kind, title, summary, and explanation.',
  `Set kind to ${BUILDER_GENERATED_EXPLANATION_KIND}.`,
  `Example JSON object: ${EXPLANATION_OUTPUT_EXAMPLE}`,
  'Do not include source-change operations.',
  'Match the user language.',
  'If the user is greeting you or making small talk, answer naturally and briefly, then invite them to ask a question or choose a project when they are ready.',
  'Do not answer greetings by listing missing context, missing files, missing plans, saved state, or prior conversation state.',
  'Use user-facing product language. Do not mention runs, tasks, schemas, receipts, providers, prompts, context digests, or authority internals.',
  'Do not claim the code was executed, previewed, saved, committed, reviewed, or changed.',
  'Do not add fields for host identities, digests, receipts, admissions, timestamps, credentials, or runtime claims.',
  'Do not include credentials, API keys, private keys, bearer tokens, or secrets.',
  'Use conversation_brief as context, including latest_plan state when explaining prior planning decisions.',
  'Treat conversation_brief.working_brief as prior discussion context only, not as evidence that files changed.',
].join('\n');
const PLAN_SYSTEM_INSTRUCTION = [
  'Propose one bounded implementation plan for the current local software project.',
  'Return one JSON object only, with no markdown fence or surrounding text.',
  'Use exactly the keys kind, title, summary, and steps.',
  `Set kind to ${BUILDER_GENERATED_PLAN_KIND}.`,
  `Example JSON object: ${PLAN_OUTPUT_EXAMPLE}`,
  'steps is an array of 1 to 12 plan steps. Each step uses exactly title, purpose, and expected_change.',
  'Keep title and each step title at 120 characters or fewer.',
  'Keep summary at 1200 characters or fewer.',
  'Keep each step purpose and expected_change at 360 characters or fewer.',
  'Do not include source-change operations, complete file content, host identities, digests, receipts, admissions, timestamps, credentials, or runtime claims.',
  'Do not claim the code was executed, previewed, saved, committed, reviewed, or changed.',
  'Do not include credentials, API keys, private keys, bearer tokens, or secrets.',
  'Use conversation_brief as context. If it contains latest_plan, treat its state as meaningful when preparing the next plan.',
  'Use conversation_brief.working_brief to avoid losing the user\'s prior goals, but do not treat it as approval to edit files.',
].join('\n');

const CODE_CHANGE_OUTPUT_CONTRACT = Object.freeze({
  kind: BUILDER_GENERATED_OPERATIONS_KIND,
  exact_keys: Object.freeze(['kind', 'title', 'summary', 'operations']),
  operation_keys: Object.freeze(['operation', 'path', 'content']),
  format: 'json_object_only',
});
const EXPLANATION_OUTPUT_CONTRACT = Object.freeze({
  kind: BUILDER_GENERATED_EXPLANATION_KIND,
  exact_keys: Object.freeze(['kind', 'title', 'summary', 'explanation']),
  format: 'json_object_only',
});
const PLAN_OUTPUT_CONTRACT = Object.freeze({
  kind: BUILDER_GENERATED_PLAN_KIND,
  exact_keys: Object.freeze(['kind', 'title', 'summary', 'steps']),
  step_keys: Object.freeze(['title', 'purpose', 'expected_change']),
  format: 'json_object_only',
});

const ERROR_MESSAGES = Object.freeze({
  builder_generation_request_invalid: 'This project request could not be verified.',
  builder_generation_base_unavailable: 'The current project source could not be verified.',
  builder_generation_structured_response_invalid: 'The generated project could not be prepared.',
});

class BuilderGenerationKernelError extends Error {
  constructor(code) {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_generation_structured_response_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderGenerationKernelError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderGenerationKernelError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, expectedKeys, code) {
  if (!isPlainObject(value)) fail(code);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail(code);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  }
}

function valueAt(value, key, code) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value, code) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, code)).join(',')}]`;
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key, code), code)}`);
    return `{${entries.join(',')}}`;
  }
  fail(code);
}

function sha256Canonical(value, code = 'builder_generation_request_invalid') {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value, code), 'utf8').digest('hex')}`;
}

function pathComparisonKey(value) {
  return value.normalize('NFKC').toLocaleUpperCase(PATH_FOLD_KEY_LOCALE);
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function hasDisallowedControl(value, allowFormatting) {
  if (UNSAFE_UNICODE_FORMAT_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0x7f && code <= 0x9f) || (code <= 0x1f && (!allowFormatting || ![0x09, 0x0a, 0x0d].includes(code)))) {
      return true;
    }
  }
  return false;
}

function containsUnsafeMaterial(value) {
  const normalized = value.normalize('NFKC');
  return LOCAL_PATH_PATTERN.test(normalized)
    || CREDENTIAL_ASSIGNMENT_PATTERN.test(normalized)
    || AUTHORIZATION_VALUE_PATTERN.test(normalized)
    || PRIVATE_KEY_PATTERN.test(normalized)
    || CREDENTIAL_URL_PATTERN.test(normalized)
    || COMMON_SECRET_VALUE_PATTERN.test(normalized);
}

function safeText(value, maximumCodePoints, maximumUtf8Bytes, allowFormatting, code) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > maximumUtf8Bytes
    || value.normalize('NFC') !== value
    || value.length > maximumCodePoints * 2
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumUtf8Bytes
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value, allowFormatting)
    || containsUnsafeMaterial(value)
  ) fail(code);
  return value;
}

function safeProjectId(value, code) {
  if (value === null) return null;
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) fail(code);
  return value;
}

function safeDigest(value, code) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail(code);
  return value;
}

function optionalOwnValue(value, key) {
  if (!isPlainObject(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined;
  return descriptor.value;
}

function sanitizeConversationPromptEvents(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || value.length > MAX_CONVERSATION_EVENTS_FOR_PROMPT
  ) fail('builder_generation_request_invalid');
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) {
    fail('builder_generation_request_invalid');
  }
  const events = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_generation_request_invalid');
    }
    if (!isPlainObject(descriptor.value)) fail('builder_generation_request_invalid');
    events.push(descriptor.value);
  }
  return events;
}

function safeConversationBriefText(value) {
  try {
    return safeText(
      value,
      MAX_CONVERSATION_BRIEF_TEXT_CODE_POINTS,
      MAX_CONVERSATION_BRIEF_TEXT_UTF8_BYTES,
      true,
      'builder_generation_request_invalid',
    );
  } catch {
    return null;
  }
}

function currentPromptTurnIds(events, requestDigest) {
  const turnIds = new Set();
  for (const event of events) {
    if (optionalOwnValue(event, 'event_type') !== 'run_started') continue;
    const payload = optionalOwnValue(event, 'payload');
    if (!isPlainObject(payload)) continue;
    if (optionalOwnValue(payload, 'input_digest') !== requestDigest) continue;
    const turnId = optionalOwnValue(payload, 'turn_id');
    if (typeof turnId === 'string') turnIds.add(turnId);
  }
  return turnIds;
}

function appendConversationBriefEntry(entries, entry) {
  if (entry.text === null) return;
  entries.push(entry);
  while (entries.length > MAX_CONVERSATION_BRIEF_ENTRIES) entries.shift();
}

function conversationBriefKind(value, fallback) {
  return typeof value === 'string' && /^[a-z_]{1,40}$/u.test(value) ? value : fallback;
}

function conversationRunKey(turnId, runId) {
  return typeof turnId === 'string' && typeof runId === 'string' ? `${turnId}:${runId}` : null;
}

function currentPromptTurnSubmitted(events, currentTurnIds) {
  let submitted = null;
  for (const event of events) {
    if (optionalOwnValue(event, 'event_type') !== 'turn_submitted') continue;
    const payload = optionalOwnValue(event, 'payload');
    if (!isPlainObject(payload)) continue;
    const turnId = optionalOwnValue(payload, 'turn_id');
    if (typeof turnId === 'string' && currentTurnIds.has(turnId)) submitted = payload;
  }
  return submitted;
}

function safeRouteDecisionSignal(value) {
  return isPublicBuilderRouteDecisionSignal(value)
    ? value
    : null;
}

function safeRouteDecisionSignals(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return [];
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) return [];
  const signals = [];
  const seen = new Set();
  for (let index = 0; index < Math.min(value.length, 8); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return [];
    const signal = safeRouteDecisionSignal(descriptor.value);
    if (signal === null || seen.has(signal)) continue;
    seen.add(signal);
    signals.push(signal);
  }
  return signals;
}

function currentPromptRouteContext(events, currentTurnIds) {
  const submitted = currentPromptTurnSubmitted(events, currentTurnIds);
  if (!isPlainObject(submitted)) return null;
  const decision = optionalOwnValue(submitted, 'route_decision');
  if (!isPlainObject(decision)) return null;
  const route = optionalOwnValue(decision, 'route');
  const dispatch = optionalOwnValue(decision, 'dispatch');
  const confidence = optionalOwnValue(decision, 'confidence');
  return freezeDeep({
    route: typeof route === 'string' && /^(?:answer|clarify|update_brief|plan|build)$/u.test(route)
      ? route
      : 'unknown',
    dispatch: typeof dispatch === 'string'
      && /^(?:reply|brief_update|plan|build|ask_workspace|ask_permission|blocked)$/u.test(dispatch)
      ? dispatch
      : 'unknown',
    confidence: typeof confidence === 'string' && /^(?:low|medium|high)$/u.test(confidence)
      ? confidence
      : 'unknown',
    matched_signals: safeRouteDecisionSignals(optionalOwnValue(decision, 'matched_signals')),
  });
}

function buildWorkingBrief(entries, latestPlan, latestTaskBrief) {
  if (latestPlan !== null && latestPlan.state === 'approved') {
    const latestUser = [...entries].reverse().find((entry) => (
      entry.role === 'user' && WORKING_BRIEF_USER_CONTEXT_PATTERN.test(entry.text)
    ));
    return freezeDeep({
      brief_version: 'builder-working-brief.v1',
      source: 'approved_plan',
      latest_user_goal: latestUser?.text ?? null,
      assistant_proposal: latestPlan.text,
      approved_plan: {
        state: 'approved',
        text: latestPlan.text,
      },
      use_when_instruction_is_contextual: true,
    });
  }
  if (latestPlan !== null) return null;
  if (latestTaskBrief !== null) return freezeDeep({ ...latestTaskBrief });

  let latestUserGoal = null;
  let latestAssistantProposal = null;
  for (const entry of entries) {
    if (entry.role === 'user') {
      if (WORKING_BRIEF_CONFIRMED_USER_PATTERN.test(entry.text)) latestUserGoal = entry.text;
      continue;
    }
    if (
      entry.role === 'assistant'
      && latestUserGoal !== null
      && WORKING_BRIEF_ASSISTANT_PROPOSAL_PATTERN.test(entry.text)
    ) {
      latestAssistantProposal = entry.text;
    }
  }
  if (latestAssistantProposal === null) return null;
  return freezeDeep({
    brief_version: 'builder-working-brief.v1',
    source: 'recent_chat_proposal',
    latest_user_goal: latestUserGoal,
    assistant_proposal: latestAssistantProposal,
    approved_plan: null,
    use_when_instruction_is_contextual: true,
  });
}

function conversationBriefFromEvents(events, requestDigest) {
  const currentTurnIds = currentPromptTurnIds(events, requestDigest);
  const entries = [];
  const planTextsByRun = new Map();
  let latestPlan = null;
  let latestTaskBrief = null;
  for (const event of events) {
    const eventType = optionalOwnValue(event, 'event_type');
    const payload = optionalOwnValue(event, 'payload');
    if (!isPlainObject(payload)) continue;
    const turnId = optionalOwnValue(payload, 'turn_id');
    if (typeof turnId === 'string' && currentTurnIds.has(turnId)) continue;
    const runKey = conversationRunKey(turnId, optionalOwnValue(payload, 'run_id'));

    if (eventType === 'turn_submitted' || eventType === 'turn_steered') {
      const message = optionalOwnValue(payload, 'message');
      const text = safeConversationBriefText(optionalOwnValue(message, 'text'));
      appendConversationBriefEntry(entries, {
        role: 'user',
        kind: eventType === 'turn_steered'
          ? 'steer'
          : conversationBriefKind(optionalOwnValue(payload, 'mode'), 'message'),
        text,
      });
      continue;
    }

    if (eventType === 'task_brief_updated') {
      if (typeof turnId === 'string' && currentTurnIds.has(turnId)) continue;
      latestTaskBrief = { ...payload.task_capsule.current_brief };
      continue;
    }

    if (eventType === 'run_completed') {
      const resultKind = conversationBriefKind(optionalOwnValue(payload, 'result_kind'), 'result');
      const message = optionalOwnValue(payload, 'assistant_message');
      const text = safeConversationBriefText(optionalOwnValue(message, 'text'));
      if (resultKind === 'plan') {
        if (runKey !== null && text !== null) {
          planTextsByRun.set(runKey, text);
          latestPlan = { state: 'proposed', text };
        }
        continue;
      }
      appendConversationBriefEntry(entries, {
        role: 'assistant',
        kind: resultKind,
        text,
      });
      continue;
    }

    if (eventType === 'plan_reviewed' && runKey !== null && planTextsByRun.has(runKey)) {
      const decision = optionalOwnValue(payload, 'decision');
      if (decision === 'approved' || decision === 'rejected') {
        latestPlan = {
          state: decision,
          text: planTextsByRun.get(runKey),
        };
      }
    }
  }
  return freezeDeep({
    context_version: CONVERSATION_BRIEF_CONTEXT_VERSION,
    selection: CONVERSATION_BRIEF_SELECTION,
    entries,
    latest_plan: latestPlan,
    working_brief: buildWorkingBrief(entries, latestPlan, latestTaskBrief),
  });
}

function buildExecutionBasis(routeContext, conversationBrief) {
  if (routeContext === null || routeContext.route !== 'build' || routeContext.dispatch !== 'build') {
    return 'not_admitted';
  }
  if (conversationBrief.latest_plan !== null && conversationBrief.latest_plan.state === 'approved') {
    return 'approved_plan';
  }
  if (
    conversationBrief.working_brief !== null
    && conversationBrief.working_brief.use_when_instruction_is_contextual === true
  ) {
    return conversationBrief.working_brief.source === 'task_capsule_update'
      ? 'task_brief'
      : 'working_brief';
  }
  if (routeContext.matched_signals.includes('current_artifact_defect')) {
    return 'current_artifact_defect';
  }
  if (
    routeContext.matched_signals.includes('contextual_build')
    || routeContext.matched_signals.includes('contextual_build_phrase')
  ) {
    return 'missing_context_not_admitted';
  }
  return 'explicit_instruction';
}

function buildContextSnapshot({
  events,
  request,
  conversationBrief,
}) {
  const currentTurnIds = currentPromptTurnIds(events, request.request_digest);
  const routeContext = currentPromptRouteContext(events, currentTurnIds);
  const workingBrief = conversationBrief.working_brief;
  const latestPlan = conversationBrief.latest_plan;
  return freezeDeep({
    snapshot_version: BUILD_CONTEXT_SNAPSHOT_VERSION,
    route: routeContext?.route ?? 'unknown',
    dispatch: routeContext?.dispatch ?? 'unknown',
    confidence: routeContext?.confidence ?? 'unknown',
    matched_signals: routeContext?.matched_signals ?? [],
    execution_basis: buildExecutionBasis(routeContext, conversationBrief),
    workspace_basis: request.existing_project_id === null
      ? 'new_project_request'
      : 'selected_project_workspace',
    working_brief: workingBrief === null
      ? {
        available: false,
        source: null,
        contextual_build_ready: false,
      }
      : {
        available: true,
        source: workingBrief.source,
        contextual_build_ready: workingBrief.use_when_instruction_is_contextual === true,
      },
    latest_plan: latestPlan === null
      ? {
        available: false,
        state: 'none',
      }
      : {
        available: true,
        state: latestPlan.state,
      },
    permissions: {
      write_project: routeContext?.route === 'build' ? 'route_required' : 'not_required_by_route',
      command_execution: 'not_available',
      external_network: 'not_available',
    },
  });
}

function deterministicUuidFromText(value) {
  const bytes = nodeCrypto.createHash('sha256').update(value, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sanitizeBuilderGenerationRequestInternal(value) {
  assertExactObject(value, REQUEST_KEYS, 'builder_generation_request_invalid');
  const version = valueAt(value, 'version', 'builder_generation_request_invalid');
  if (version !== BUILDER_GENERATION_REQUEST_PROTOCOL) fail('builder_generation_request_invalid');
  const unsigned = {
    version: BUILDER_GENERATION_REQUEST_PROTOCOL,
    instruction: safeText(
      valueAt(value, 'instruction', 'builder_generation_request_invalid'),
      MAX_INSTRUCTION_CODE_POINTS,
      MAX_INSTRUCTION_UTF8_BYTES,
      true,
      'builder_generation_request_invalid',
    ),
    existing_project_id: safeProjectId(
      valueAt(value, 'existing_project_id', 'builder_generation_request_invalid'),
      'builder_generation_request_invalid',
    ),
  };
  const digest = safeDigest(
    valueAt(value, 'request_digest', 'builder_generation_request_invalid'),
    'builder_generation_request_invalid',
  );
  if (sha256Canonical(unsigned, 'builder_generation_request_invalid') !== digest) {
    fail('builder_generation_request_invalid');
  }
  return freezeDeep({ ...unsigned, request_digest: digest });
}

function sanitizeBuilderGenerationRequest(value) {
  try {
    return sanitizeBuilderGenerationRequestInternal(value);
  } catch (error) {
    if (error instanceof BuilderGenerationKernelError) throw error;
    fail('builder_generation_request_invalid');
  }
}

function createBuilderGenerationRequest(value) {
  try {
    assertExactObject(value, REQUEST_INPUT_KEYS, 'builder_generation_request_invalid');
    const unsigned = {
      version: BUILDER_GENERATION_REQUEST_PROTOCOL,
      instruction: safeText(
        valueAt(value, 'instruction', 'builder_generation_request_invalid'),
        MAX_INSTRUCTION_CODE_POINTS,
        MAX_INSTRUCTION_UTF8_BYTES,
        true,
        'builder_generation_request_invalid',
      ),
      existing_project_id: safeProjectId(
        valueAt(value, 'existing_project_id', 'builder_generation_request_invalid'),
        'builder_generation_request_invalid',
      ),
    };
    return freezeDeep({
      ...unsigned,
      request_digest: sha256Canonical(unsigned, 'builder_generation_request_invalid'),
    });
  } catch (error) {
    if (error instanceof BuilderGenerationKernelError) throw error;
    fail('builder_generation_request_invalid');
  }
}

function sanitizePromptInput(value) {
  assertExactObject(value, PROMPT_INPUT_KEYS, 'builder_generation_request_invalid');
  const request = sanitizeBuilderGenerationRequestInternal(
    valueAt(value, 'request', 'builder_generation_request_invalid'),
  );
  const conversationEvents = sanitizeConversationPromptEvents(
    valueAt(value, 'conversation_events', 'builder_generation_request_invalid'),
  );
  let baseSourceTree;
  try {
    baseSourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'base_source_tree', 'builder_generation_base_unavailable'));
  } catch {
    fail('builder_generation_base_unavailable');
  }
  return {
    request,
    baseSourceTree,
    conversationEvents,
    conversationBrief: conversationBriefFromEvents(conversationEvents, request.request_digest),
  };
}

function sanitizePlanPromptInput(value) {
  assertExactObject(value, PLAN_PROMPT_INPUT_KEYS, 'builder_generation_request_invalid');
  const request = sanitizeBuilderGenerationRequestInternal(
    valueAt(value, 'request', 'builder_generation_request_invalid'),
  );
  const rawSourceContext = valueAt(value, 'source_context_result', 'builder_generation_base_unavailable');
  let sourceContextResult;
  try {
    sourceContextResult = sanitizePlanPromptSourceContextResult(
      rawSourceContext,
    );
  } catch {
    fail('builder_generation_base_unavailable');
  }
  const rawContext = valueAt(rawSourceContext, 'context', 'builder_generation_base_unavailable');
  const conversationEvents = sanitizeConversationPromptEvents(
    valueAt(rawContext, 'events', 'builder_generation_base_unavailable'),
  );
  return {
    request,
    sourceContextResult,
    conversationBrief: conversationBriefFromEvents(conversationEvents, request.request_digest),
  };
}

function sanitizePlanPromptSourceContextResult(value) {
  const publicBinding = sanitizeBuilderPlanProposalSourceContextResult(value);
  const privateContext = valueAt(value, 'private_source_context', 'builder_generation_base_unavailable');
  assertExactObject(privateContext, PLAN_PROMPT_PRIVATE_CONTEXT_KEYS, 'builder_generation_base_unavailable');
  if (
    valueAt(privateContext, 'context_version', 'builder_generation_base_unavailable')
      !== 'builder-private-source-context.v1'
  ) fail('builder_generation_base_unavailable');
  const files = valueAt(privateContext, 'files', 'builder_generation_base_unavailable');
  if (
    !Array.isArray(files)
    || utilTypes.isProxy(files)
    || files.length !== publicBinding.context_binding.file_count
  ) fail('builder_generation_base_unavailable');
  const keys = Reflect.ownKeys(files);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== files.length + 1) {
    fail('builder_generation_base_unavailable');
  }
  const safeFiles = [];
  for (let index = 0; index < files.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(files, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_generation_base_unavailable');
    }
    const file = descriptor.value;
    assertExactObject(file, PLAN_PROMPT_PRIVATE_FILE_KEYS, 'builder_generation_base_unavailable');
    if (valueAt(file, 'entry_kind', 'builder_generation_base_unavailable') !== 'text_file') {
      fail('builder_generation_base_unavailable');
    }
    safeFiles.push({
      path: valueAt(file, 'path', 'builder_generation_base_unavailable'),
      content: valueAt(file, 'content', 'builder_generation_base_unavailable'),
    });
  }
  return freezeDeep({
    ...publicBinding,
    private_source_context: {
      context_version: 'builder-private-source-context.v1',
      files: safeFiles,
    },
  });
}

function promptDescriptor(value, promptVersion, systemInstruction, outputContract) {
  try {
    const {
      request,
      baseSourceTree,
      conversationEvents,
      conversationBrief,
    } = sanitizePromptInput(value);
    const userContext = {
      instruction: request.instruction,
      mode: request.existing_project_id === null ? 'create' : 'revise',
      conversation_brief: conversationBrief,
      current_source_tree: {
        files: baseSourceTree.files.map((file) => ({
          path: file.path,
          content: file.content,
        })),
      },
    };
    if (outputContract.kind === BUILDER_GENERATED_OPERATIONS_KIND) {
      userContext.build_context_snapshot = buildContextSnapshot({
        events: conversationEvents,
        request,
        conversationBrief,
      });
    }
    const descriptor = {
      version: BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION,
      request_id: request.request_digest,
      prompt_version: promptVersion,
      system_instruction: systemInstruction,
      user_instruction: canonicalJson(userContext, 'builder_generation_request_invalid'),
      output_contract: outputContract,
      max_generated_text_bytes: MAX_GENERATED_TEXT_BYTES,
    };
    if (Buffer.byteLength(canonicalJson(descriptor, 'builder_generation_request_invalid'), 'utf8')
      > MAX_PROMPT_DESCRIPTOR_BYTES) {
      fail('builder_generation_base_unavailable');
    }
    return freezeDeep(descriptor);
  } catch (error) {
    if (error instanceof BuilderGenerationKernelError) throw error;
    fail('builder_generation_request_invalid');
  }
}

function planPromptDescriptor(value, promptVersion, systemInstruction, outputContract) {
  try {
    const { request, sourceContextResult, conversationBrief } = sanitizePlanPromptInput(value);
    const userContext = {
      instruction: request.instruction,
      mode: 'plan',
      conversation_brief: conversationBrief,
      current_source_context: {
        files: sourceContextResult.private_source_context.files.map((file) => ({
          path: file.path,
          content: file.content,
        })),
      },
    };
    const descriptor = {
      version: BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION,
      request_id: request.request_digest,
      prompt_version: promptVersion,
      system_instruction: systemInstruction,
      user_instruction: canonicalJson(userContext, 'builder_generation_request_invalid'),
      output_contract: outputContract,
      max_generated_text_bytes: MAX_GENERATED_TEXT_BYTES,
    };
    if (Buffer.byteLength(canonicalJson(descriptor, 'builder_generation_request_invalid'), 'utf8')
      > MAX_PROMPT_DESCRIPTOR_BYTES) {
      fail('builder_generation_base_unavailable');
    }
    return freezeDeep(descriptor);
  } catch (error) {
    if (error instanceof BuilderGenerationKernelError) throw error;
    fail('builder_generation_request_invalid');
  }
}

function createBuilderGenerationPromptDescriptor(value) {
  return promptDescriptor(
    value,
    BUILDER_CODE_PROJECT_PROMPT_VERSION,
    CODE_CHANGE_SYSTEM_INSTRUCTION,
    {
      kind: CODE_CHANGE_OUTPUT_CONTRACT.kind,
      exact_keys: [...CODE_CHANGE_OUTPUT_CONTRACT.exact_keys],
      operation_keys: [...CODE_CHANGE_OUTPUT_CONTRACT.operation_keys],
      format: CODE_CHANGE_OUTPUT_CONTRACT.format,
    },
  );
}

function createBuilderExplanationPromptDescriptor(value) {
  return promptDescriptor(
    value,
    'builder-project-explanation.v1',
    EXPLANATION_SYSTEM_INSTRUCTION,
    {
      kind: EXPLANATION_OUTPUT_CONTRACT.kind,
      exact_keys: [...EXPLANATION_OUTPUT_CONTRACT.exact_keys],
      format: EXPLANATION_OUTPUT_CONTRACT.format,
    },
  );
}

function createBuilderPlanPromptDescriptor(value) {
  return planPromptDescriptor(
    value,
    BUILDER_PLAN_PROJECT_PROMPT_VERSION,
    PLAN_SYSTEM_INSTRUCTION,
    {
      kind: PLAN_OUTPUT_CONTRACT.kind,
      exact_keys: [...PLAN_OUTPUT_CONTRACT.exact_keys],
      step_keys: [...PLAN_OUTPUT_CONTRACT.step_keys],
      format: PLAN_OUTPUT_CONTRACT.format,
    },
  );
}

function sanitizeGeneratedOperations(value) {
  assertExactObject(value, PROVIDER_OUTPUT_KEYS, 'builder_generation_structured_response_invalid');
  if (valueAt(value, 'kind', 'builder_generation_structured_response_invalid')
    !== BUILDER_GENERATED_OPERATIONS_KIND) fail('builder_generation_structured_response_invalid');
  const operations = valueAt(value, 'operations', 'builder_generation_structured_response_invalid');
  if (!Array.isArray(operations) || utilTypes.isProxy(operations) || operations.length === 0 || operations.length > 256) {
    fail('builder_generation_structured_response_invalid');
  }
  const keys = Reflect.ownKeys(operations);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== operations.length + 1) {
    fail('builder_generation_structured_response_invalid');
  }
  const safeOperations = [];
  for (let index = 0; index < operations.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(operations, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_generation_structured_response_invalid');
    }
    const operation = descriptor.value;
    assertExactObject(operation, RAW_OPERATION_KEYS, 'builder_generation_structured_response_invalid');
    safeOperations.push({
      operation: valueAt(operation, 'operation', 'builder_generation_structured_response_invalid'),
      path: valueAt(operation, 'path', 'builder_generation_structured_response_invalid'),
      content: valueAt(operation, 'content', 'builder_generation_structured_response_invalid'),
    });
  }
  return {
    title: safeText(
      valueAt(value, 'title', 'builder_generation_structured_response_invalid'),
      80,
      512,
      false,
      'builder_generation_structured_response_invalid',
    ),
    summary: safeText(
      valueAt(value, 'summary', 'builder_generation_structured_response_invalid'),
      400,
      2 * 1024,
      false,
      'builder_generation_structured_response_invalid',
    ),
    operations: safeOperations,
  };
}

function sanitizeRawGeneratedOperation(value) {
  assertExactObject(value, RAW_OPERATION_KEYS, 'builder_generation_structured_response_invalid');
  const operation = valueAt(value, 'operation', 'builder_generation_structured_response_invalid');
  if (operation !== 'upsert' && operation !== 'delete') fail('builder_generation_structured_response_invalid');
  const content = valueAt(value, 'content', 'builder_generation_structured_response_invalid');
  if ((operation === 'delete') !== (content === null)) fail('builder_generation_structured_response_invalid');
  const single = createBuilderProjectSourceTree({
    files: [{
      path: valueAt(value, 'path', 'builder_generation_structured_response_invalid'),
      content: operation === 'upsert' ? content : '',
    }],
  }).files[0];
  return {
    operation,
    path: single.path,
    content: operation === 'upsert' ? single.content : null,
  };
}

function applyProviderOperationsToSourceTree(baseSourceTree, operations) {
  const sourceTree = sanitizeBuilderProjectSourceTree(baseSourceTree);
  const filesByPath = new Map(sourceTree.files.map((file) => [
    pathComparisonKey(file.path),
    { path: file.path, content: file.content },
  ]));
  const seenOperations = new Set();
  for (const rawOperation of operations) {
    const operation = sanitizeRawGeneratedOperation(rawOperation);
    const key = pathComparisonKey(operation.path);
    if (seenOperations.has(key)) fail('builder_generation_structured_response_invalid');
    seenOperations.add(key);
    if (operation.operation === 'delete') {
      if (!filesByPath.has(key)) fail('builder_generation_structured_response_invalid');
      filesByPath.delete(key);
    } else {
      filesByPath.set(key, { path: operation.path, content: operation.content });
    }
  }
  return createBuilderProjectSourceTree({ files: [...filesByPath.values()] });
}

function operationsToReachSourceTree(baseSourceTree, targetSourceTree) {
  const base = sanitizeBuilderProjectSourceTree(baseSourceTree);
  const target = sanitizeBuilderProjectSourceTree(targetSourceTree);
  const targetByPath = new Map(target.files.map((file) => [pathComparisonKey(file.path), file]));
  const operations = [];
  for (const file of base.files) {
    if (!targetByPath.has(pathComparisonKey(file.path))) {
      operations.push({ operation: 'delete', path: file.path, content: null });
    }
  }
  const baseByPath = new Map(base.files.map((file) => [pathComparisonKey(file.path), file]));
  for (const file of target.files) {
    const current = baseByPath.get(pathComparisonKey(file.path));
    if (current === undefined || current.content_digest !== file.content_digest || current.path !== file.path) {
      operations.push({ operation: 'upsert', path: file.path, content: file.content });
    }
  }
  if (operations.length === 0) fail('builder_generation_structured_response_invalid');
  return operations;
}

function sanitizeGeneratedPlanSteps(value, requestDigest) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || value.length < 1
    || value.length > MAX_PLAN_STEP_COUNT
  ) fail('builder_generation_structured_response_invalid');
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) {
    fail('builder_generation_structured_response_invalid');
  }
  return value.map((rawStep, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_generation_structured_response_invalid');
    }
    assertExactObject(rawStep, RAW_PLAN_STEP_KEYS, 'builder_generation_structured_response_invalid');
    const title = safeText(
      valueAt(rawStep, 'title', 'builder_generation_structured_response_invalid'),
      MAX_PLAN_STEP_TITLE_CODE_POINTS,
      MAX_PLAN_STEP_TITLE_UTF8_BYTES,
      false,
      'builder_generation_structured_response_invalid',
    );
    const purpose = safeText(
      valueAt(rawStep, 'purpose', 'builder_generation_structured_response_invalid'),
      MAX_PLAN_STEP_TEXT_CODE_POINTS,
      MAX_PLAN_STEP_TEXT_UTF8_BYTES,
      false,
      'builder_generation_structured_response_invalid',
    );
    const expectedChange = safeText(
      valueAt(rawStep, 'expected_change', 'builder_generation_structured_response_invalid'),
      MAX_PLAN_STEP_TEXT_CODE_POINTS,
      MAX_PLAN_STEP_TEXT_UTF8_BYTES,
      false,
      'builder_generation_structured_response_invalid',
    );
    return {
      plan_step_id: `builder-plan-step:${deterministicUuidFromText(`${requestDigest}:${index}:${title}:${purpose}:${expectedChange}`)}`,
      title,
      purpose,
      expected_change: expectedChange,
      status: 'proposed',
    };
  });
}

function sanitizeGeneratedPlan(value, requestDigest) {
  assertExactObject(value, PLAN_OUTPUT_KEYS, 'builder_generation_structured_response_invalid');
  if (valueAt(value, 'kind', 'builder_generation_structured_response_invalid')
    !== BUILDER_GENERATED_PLAN_KIND) fail('builder_generation_structured_response_invalid');
  return {
    title: safeText(
      valueAt(value, 'title', 'builder_generation_structured_response_invalid'),
      120,
      512,
      false,
      'builder_generation_structured_response_invalid',
    ),
    summary: safeText(
      valueAt(value, 'summary', 'builder_generation_structured_response_invalid'),
      1200,
      4 * 1024,
      true,
      'builder_generation_structured_response_invalid',
    ),
    steps: sanitizeGeneratedPlanSteps(
      valueAt(value, 'steps', 'builder_generation_structured_response_invalid'),
      requestDigest,
    ),
  };
}

function sanitizeGeneratedExplanation(value) {
  assertExactObject(value, EXPLANATION_OUTPUT_KEYS, 'builder_generation_structured_response_invalid');
  if (valueAt(value, 'kind', 'builder_generation_structured_response_invalid')
    !== BUILDER_GENERATED_EXPLANATION_KIND) fail('builder_generation_structured_response_invalid');
  return {
    title: safeText(
      valueAt(value, 'title', 'builder_generation_structured_response_invalid'),
      80,
      512,
      false,
      'builder_generation_structured_response_invalid',
    ),
    summary: safeText(
      valueAt(value, 'summary', 'builder_generation_structured_response_invalid'),
      400,
      2 * 1024,
      false,
      'builder_generation_structured_response_invalid',
    ),
    explanation: safeText(
      valueAt(value, 'explanation', 'builder_generation_structured_response_invalid'),
      MAX_EXPLANATION_CODE_POINTS,
      MAX_EXPLANATION_UTF8_BYTES,
      true,
      'builder_generation_structured_response_invalid',
    ),
  };
}

function parseProviderOutputText(value, requestDigest = '') {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_GENERATED_TEXT_BYTES
    || Buffer.byteLength(value, 'utf8') > MAX_GENERATED_TEXT_BYTES
    || hasUnpairedSurrogate(value)
  ) fail('builder_generation_structured_response_invalid');
  const text = value.trim();
  if (text.length === 0 || text.startsWith('```')) fail('builder_generation_structured_response_invalid');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('builder_generation_structured_response_invalid');
  }
  if (!isPlainObject(parsed)) fail('builder_generation_structured_response_invalid');
  const kind = valueAt(parsed, 'kind', 'builder_generation_structured_response_invalid');
  if (kind === BUILDER_GENERATED_OPERATIONS_KIND) return { result_kind: 'candidate', ...sanitizeGeneratedOperations(parsed) };
  if (kind === BUILDER_GENERATED_EXPLANATION_KIND) return { result_kind: 'explanation', ...sanitizeGeneratedExplanation(parsed) };
  if (kind === BUILDER_GENERATED_PLAN_KIND) return { result_kind: 'plan', ...sanitizeGeneratedPlan(parsed, requestDigest) };
  fail('builder_generation_structured_response_invalid');
}

function projectBuilderGenerationResult(value) {
  try {
    assertExactObject(value, RESULT_INPUT_KEYS, 'builder_generation_request_invalid');
    const request = sanitizeBuilderGenerationRequestInternal(
      valueAt(value, 'request', 'builder_generation_request_invalid'),
    );
    const generated = parseProviderOutputText(
      valueAt(value, 'generated_text', 'builder_generation_structured_response_invalid'),
    );
    if (generated.result_kind !== 'candidate') fail('builder_generation_structured_response_invalid');
    let candidate;
    try {
      candidate = createBuilderCodeChangeCandidate({
        conversation_events: valueAt(value, 'conversation_events', 'builder_generation_request_invalid'),
        turn_id: valueAt(value, 'turn_id', 'builder_generation_request_invalid'),
        run_id: valueAt(value, 'run_id', 'builder_generation_request_invalid'),
        base_revision_evidence: valueAt(value, 'base_revision_evidence', 'builder_generation_base_unavailable'),
        base_source_tree: valueAt(value, 'base_source_tree', 'builder_generation_base_unavailable'),
        operations: generated.operations,
      });
    } catch (error) {
      if (error instanceof BuilderCodeChangeKernelError || error instanceof BuilderProjectSourceTreeError) {
        fail('builder_generation_structured_response_invalid');
      }
      throw error;
    }
    if (candidate.request_digest !== request.request_digest) fail('builder_generation_request_invalid');
    return freezeDeep({
      version: BUILDER_GENERATION_RESULT_PROTOCOL,
      result_kind: 'candidate',
      request_id: request.request_digest,
      title: generated.title,
      summary: generated.summary,
      candidate,
      admissions: {
        conversation: 'candidate_local_not_recorded',
        draft: 'candidate_not_saved',
        save: 'not_performed',
        preview: 'not_evaluated',
        execution: 'not_evaluated',
      },
    });
  } catch (error) {
    if (error instanceof BuilderGenerationKernelError) throw error;
    fail('builder_generation_structured_response_invalid');
  }
}

function projectBuilderDraftContinuationGenerationResult(value) {
  try {
    assertExactObject(value, DRAFT_CONTINUATION_RESULT_INPUT_KEYS, 'builder_generation_request_invalid');
    const request = sanitizeBuilderGenerationRequestInternal(
      valueAt(value, 'request', 'builder_generation_request_invalid'),
    );
    const generated = parseProviderOutputText(
      valueAt(value, 'generated_text', 'builder_generation_structured_response_invalid'),
    );
    if (generated.result_kind !== 'candidate') fail('builder_generation_structured_response_invalid');
    const targetSourceTree = applyProviderOperationsToSourceTree(
      valueAt(value, 'prompt_base_source_tree', 'builder_generation_base_unavailable'),
      generated.operations,
    );
    let candidate;
    try {
      candidate = createBuilderCodeChangeCandidate({
        conversation_events: valueAt(value, 'conversation_events', 'builder_generation_request_invalid'),
        turn_id: valueAt(value, 'turn_id', 'builder_generation_request_invalid'),
        run_id: valueAt(value, 'run_id', 'builder_generation_request_invalid'),
        base_revision_evidence: valueAt(value, 'candidate_base_revision_evidence', 'builder_generation_base_unavailable'),
        base_source_tree: valueAt(value, 'candidate_base_source_tree', 'builder_generation_base_unavailable'),
        operations: operationsToReachSourceTree(
          valueAt(value, 'candidate_base_source_tree', 'builder_generation_base_unavailable'),
          targetSourceTree,
        ),
      });
    } catch (error) {
      if (
        error instanceof BuilderCodeChangeKernelError
        || error instanceof BuilderProjectSourceTreeError
      ) {
        fail('builder_generation_structured_response_invalid');
      }
      throw error;
    }
    if (candidate.request_digest !== request.request_digest) fail('builder_generation_request_invalid');
    return freezeDeep({
      version: BUILDER_GENERATION_RESULT_PROTOCOL,
      result_kind: 'candidate',
      request_id: request.request_digest,
      title: generated.title,
      summary: generated.summary,
      candidate,
      admissions: {
        conversation: 'candidate_local_not_recorded',
        draft: 'candidate_not_saved',
        save: 'not_performed',
        preview: 'not_evaluated',
        execution: 'not_evaluated',
      },
    });
  } catch (error) {
    if (error instanceof BuilderGenerationKernelError) throw error;
    fail('builder_generation_structured_response_invalid');
  }
}

function projectBuilderExplanationResult(value) {
  try {
    assertExactObject(value, ['request', 'generated_text'], 'builder_generation_request_invalid');
    const request = sanitizeBuilderGenerationRequestInternal(
      valueAt(value, 'request', 'builder_generation_request_invalid'),
    );
    const generated = parseProviderOutputText(
      valueAt(value, 'generated_text', 'builder_generation_structured_response_invalid'),
    );
    if (generated.result_kind !== 'explanation') fail('builder_generation_structured_response_invalid');
    return freezeDeep({
      version: BUILDER_GENERATION_RESULT_PROTOCOL,
      result_kind: 'explanation',
      request_id: request.request_digest,
      title: generated.title,
      summary: generated.summary,
      explanation: generated.explanation,
      admissions: {
        conversation: 'explanation_local_not_recorded',
        draft: 'not_created',
        save: 'not_performed',
        preview: 'not_applicable',
        execution: 'not_evaluated',
      },
    });
  } catch (error) {
    if (error instanceof BuilderGenerationKernelError) throw error;
    fail('builder_generation_structured_response_invalid');
  }
}

function projectBuilderPlanProposalResult(value) {
  try {
    assertExactObject(value, PLAN_RESULT_INPUT_KEYS, 'builder_generation_request_invalid');
    const request = sanitizeBuilderGenerationRequestInternal(
      valueAt(value, 'request', 'builder_generation_request_invalid'),
    );
    const sourceContextResult = valueAt(value, 'source_context_result', 'builder_generation_base_unavailable');
    const generated = parseProviderOutputText(
      valueAt(value, 'generated_text', 'builder_generation_structured_response_invalid'),
      request.request_digest,
    );
    if (generated.result_kind !== 'plan') fail('builder_generation_structured_response_invalid');
    let planProposalRecord;
    try {
      planProposalRecord = createBuilderPlanProposalRecord({
        source_context_result: sourceContextResult,
        proposed_at_ms: valueAt(value, 'proposed_at_ms', 'builder_generation_request_invalid'),
        title: generated.title,
        summary: generated.summary,
        steps: generated.steps,
      });
    } catch (error) {
      if (error instanceof BuilderPlanProposalRecordError) {
        fail('builder_generation_structured_response_invalid');
      }
      throw error;
    }
    return freezeDeep({
      version: BUILDER_GENERATION_RESULT_PROTOCOL,
      result_kind: 'plan',
      request_id: request.request_digest,
      title: planProposalRecord.title,
      summary: planProposalRecord.summary,
      steps: planProposalRecord.steps.map((step) => ({
        title: step.title,
        purpose: step.purpose,
        expected_change: step.expected_change,
        status: step.status,
      })),
      plan_proposal_record: planProposalRecord,
      admissions: {
        conversation: 'plan_local_not_recorded',
        draft: 'not_created',
        save: 'not_performed',
        preview: 'not_applicable',
        execution: 'not_evaluated',
        revision: 'not_created',
      },
    });
  } catch (error) {
    if (error instanceof BuilderGenerationKernelError) throw error;
    fail('builder_generation_structured_response_invalid');
  }
}

module.exports = Object.freeze({
  BUILDER_GENERATED_PLAN_KIND,
  BUILDER_GENERATED_EXPLANATION_KIND,
  BUILDER_GENERATED_OPERATIONS_KIND,
  BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION,
  BUILDER_GENERATION_REQUEST_PROTOCOL,
  BUILDER_GENERATION_RESULT_PROTOCOL,
  MAX_GENERATED_TEXT_BYTES,
  BuilderGenerationKernelError,
  createBuilderGenerationRequest,
  sanitizeBuilderGenerationRequest,
  createBuilderExplanationPromptDescriptor,
  createBuilderGenerationPromptDescriptor,
  createBuilderPlanPromptDescriptor,
  projectBuilderExplanationResult,
  projectBuilderDraftContinuationGenerationResult,
  projectBuilderGenerationResult,
  projectBuilderPlanProposalResult,
});
