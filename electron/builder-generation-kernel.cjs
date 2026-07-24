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
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_CODE_PROJECT_PROMPT_VERSION = 'builder-code-project.v3';
const BUILDER_GENERATION_REQUEST_PROTOCOL = 'builder-generation-request.v2';
const BUILDER_GENERATION_RESULT_PROTOCOL = 'builder-generation-result.v2';
const BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION = 'builder-generation-prompt-descriptor.v2';
const BUILDER_GENERATED_OPERATIONS_KIND = 'builder_code_change_operations';

const MAX_INSTRUCTION_CODE_POINTS = 4000;
const MAX_INSTRUCTION_UTF8_BYTES = 16 * 1024;
const MAX_GENERATED_TEXT_BYTES = MAX_CODE_CHANGE_CANDIDATE_UTF8_BYTES;
const MAX_PROMPT_DESCRIPTOR_BYTES = MAX_SOURCE_TREE_UTF8_BYTES + (96 * 1024);

const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_ASSIGNMENT_PATTERN = /["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S/iu;
const AUTHORIZATION_VALUE_PATTERN = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}/iu;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^\s/:@]+:[^\s/@]+@/iu;
const COMMON_SECRET_VALUE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/u;

const REQUEST_KEYS = Object.freeze(['version', 'instruction', 'existing_project_id', 'request_digest']);
const REQUEST_INPUT_KEYS = Object.freeze(['instruction', 'existing_project_id']);
const PROMPT_INPUT_KEYS = Object.freeze(['request', 'base_source_tree']);
const RESULT_INPUT_KEYS = Object.freeze([
  'request',
  'base_revision_evidence',
  'base_source_tree',
  'conversation_events',
  'turn_id',
  'run_id',
  'generated_text',
]);
const PROVIDER_OUTPUT_KEYS = Object.freeze(['kind', 'title', 'summary', 'operations']);
const RAW_OPERATION_KEYS = Object.freeze(['operation', 'path', 'content']);

const JSON_OUTPUT_EXAMPLE = JSON.stringify({
  kind: BUILDER_GENERATED_OPERATIONS_KIND,
  title: 'Focus timer',
  summary: 'A calm timer with one clear action.',
  operations: [
    { operation: 'upsert', path: 'index.html', content: '<main><h1>Focus timer</h1></main>\n' },
    { operation: 'upsert', path: 'src/app.js', content: 'console.log("ready");\n' },
  ],
});

const SYSTEM_INSTRUCTION = [
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
].join('\n');

const OUTPUT_CONTRACT = Object.freeze({
  kind: BUILDER_GENERATED_OPERATIONS_KIND,
  exact_keys: Object.freeze(['kind', 'title', 'summary', 'operations']),
  operation_keys: Object.freeze(['operation', 'path', 'content']),
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
  let baseSourceTree;
  try {
    baseSourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'base_source_tree', 'builder_generation_base_unavailable'));
  } catch {
    fail('builder_generation_base_unavailable');
  }
  return { request, baseSourceTree };
}

function createBuilderGenerationPromptDescriptor(value) {
  try {
    const { request, baseSourceTree } = sanitizePromptInput(value);
    const userContext = {
      instruction: request.instruction,
      mode: request.existing_project_id === null ? 'create' : 'revise',
      current_source_tree: {
        files: baseSourceTree.files.map((file) => ({
          path: file.path,
          content: file.content,
        })),
      },
    };
    const descriptor = {
      version: BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION,
      request_id: request.request_digest,
      prompt_version: BUILDER_CODE_PROJECT_PROMPT_VERSION,
      system_instruction: SYSTEM_INSTRUCTION,
      user_instruction: canonicalJson(userContext, 'builder_generation_request_invalid'),
      output_contract: {
        kind: OUTPUT_CONTRACT.kind,
        exact_keys: [...OUTPUT_CONTRACT.exact_keys],
        operation_keys: [...OUTPUT_CONTRACT.operation_keys],
        format: OUTPUT_CONTRACT.format,
      },
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

function parseGeneratedText(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > MAX_GENERATED_TEXT_BYTES
    || Buffer.byteLength(value, 'utf8') > MAX_GENERATED_TEXT_BYTES
    || hasUnpairedSurrogate(value)
    || value.startsWith('```')
  ) fail('builder_generation_structured_response_invalid');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail('builder_generation_structured_response_invalid');
  }
  return sanitizeGeneratedOperations(parsed);
}

function projectBuilderGenerationResult(value) {
  try {
    assertExactObject(value, RESULT_INPUT_KEYS, 'builder_generation_request_invalid');
    const request = sanitizeBuilderGenerationRequestInternal(
      valueAt(value, 'request', 'builder_generation_request_invalid'),
    );
    const generated = parseGeneratedText(
      valueAt(value, 'generated_text', 'builder_generation_structured_response_invalid'),
    );
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

module.exports = Object.freeze({
  BUILDER_GENERATED_OPERATIONS_KIND,
  BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION,
  BUILDER_GENERATION_REQUEST_PROTOCOL,
  BUILDER_GENERATION_RESULT_PROTOCOL,
  MAX_GENERATED_TEXT_BYTES,
  BuilderGenerationKernelError,
  createBuilderGenerationRequest,
  sanitizeBuilderGenerationRequest,
  createBuilderGenerationPromptDescriptor,
  projectBuilderGenerationResult,
});
