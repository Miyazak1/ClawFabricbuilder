'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  MAX_RECORD_BYTES,
  digestBuilderProjectProposalRecord,
  sanitizeBuilderProjectRevisionRecord,
} = require('./builder-project-revision-record.cjs');

const BUILDER_PROJECT_PROPOSAL_KIND = 'builder_code_project';
const BUILDER_CODE_GENERATOR_AUTHORITY = 'builder_code_project_generator';
const BUILDER_CODE_PROJECT_PROMPT_VERSION = 'builder-code-project.v1';
const BUILDER_GENERATION_REQUEST_PROTOCOL = 'builder-generation-request.v1';
const BUILDER_GENERATION_RESULT_PROTOCOL = 'builder-generation-result.v1';
const BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION = 'builder-generation-prompt-descriptor.v1';

const MAX_IDEA_CODE_POINTS = 4000;
const MAX_IDEA_UTF8_BYTES = 16 * 1024;
const MAX_GENERATED_TEXT_BYTES = MAX_RECORD_BYTES;
const MAX_PROMPT_DESCRIPTOR_BYTES = MAX_RECORD_BYTES + (32 * 1024);

const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_ASSIGNMENT_PATTERN = /["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S/iu;
const AUTHORIZATION_VALUE_PATTERN = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}/iu;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^\s/:@]+:[^\s/@]+@/iu;
const COMMON_SECRET_VALUE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/u;

const REQUEST_KEYS = Object.freeze([
  'version',
  'idea',
  'project_id',
  'target_revision',
  'parent_revision',
  'request_digest',
]);
const PARENT_KEYS = Object.freeze(['revision', 'revision_digest']);
const PROMPT_INPUT_KEYS = Object.freeze(['request', 'parent_revision_record']);
const RESULT_INPUT_KEYS = Object.freeze(['request', 'parent_revision_record', 'generated_text']);
const PROPOSAL_KEYS = Object.freeze(['kind', 'title', 'summary', 'files']);
const FILE_KEYS = Object.freeze(['index.html', 'styles.css', 'app.js']);

const SYSTEM_INSTRUCTION = [
  'Create or revise one small web project.',
  'Return one JSON object only, with no markdown fence or surrounding text.',
  'Use exactly the keys kind, title, summary, and files.',
  'Set kind to builder_code_project.',
  'Use exactly index.html, styles.css, and app.js inside files.',
  'The host stores and assembles these three files separately; index.html must not reference styles.css or app.js.',
  'Put all styling in styles.css and all optional interaction logic in app.js.',
  'Keep index.html static: no scripts, active embeds, forms, navigation, event handlers, or URL-bearing attributes.',
  'Do not include script, link, style, form, iframe, meta, or other active tags in index.html.',
  'Keep styles.css self-contained: no imports, fonts, URLs, images, or executable CSS.',
  'Keep app.js self-contained and do not use import, export, or dynamic module loading.',
  'Do not add fields for host identities, evidence, admissions, or runtime claims.',
  'Do not include credentials or local filesystem paths.',
].join('\n');

const OUTPUT_CONTRACT = Object.freeze({
  kind: BUILDER_PROJECT_PROPOSAL_KIND,
  exact_keys: Object.freeze(['kind', 'title', 'summary', 'files']),
  exact_file_keys: Object.freeze(['index.html', 'styles.css', 'app.js']),
  format: 'json_object_only',
});

const ERROR_MESSAGES = Object.freeze({
  builder_generation_request_invalid: 'This project request could not be verified.',
  builder_generation_parent_invalid: 'The current project version could not be verified.',
  builder_generation_response_invalid: 'The generated project could not be used.',
});

class BuilderGenerationKernelError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.builder_generation_response_invalid);
    this.name = 'BuilderGenerationKernelError';
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'builder_generation_response_invalid';
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

function sha256Canonical(value, code) {
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

function hasDisallowedIdeaControl(value) {
  if (UNSAFE_UNICODE_FORMAT_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0x7f && code <= 0x9f) || (code <= 0x1f && ![0x09, 0x0a, 0x0d].includes(code))) {
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

function safeIdea(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > MAX_IDEA_UTF8_BYTES
    || value.normalize('NFC') !== value
    || value.length > MAX_IDEA_CODE_POINTS * 2
    || Array.from(value).length > MAX_IDEA_CODE_POINTS
    || Buffer.byteLength(value, 'utf8') > MAX_IDEA_UTF8_BYTES
    || hasUnpairedSurrogate(value)
    || hasDisallowedIdeaControl(value)
    || containsUnsafeMaterial(value)
  ) fail('builder_generation_request_invalid');
  return value;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) {
    fail('builder_generation_request_invalid');
  }
  return value;
}

function safeDigest(value, code) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail(code);
  return value;
}

function sanitizeParent(value) {
  if (value === null) return null;
  assertExactObject(value, PARENT_KEYS, 'builder_generation_request_invalid');
  const revision = valueAt(value, 'revision', 'builder_generation_request_invalid');
  if (!Number.isSafeInteger(revision) || revision < 1) fail('builder_generation_request_invalid');
  return {
    revision,
    revision_digest: safeDigest(
      valueAt(value, 'revision_digest', 'builder_generation_request_invalid'),
      'builder_generation_request_invalid',
    ),
  };
}

function sanitizeBuilderGenerationRequestInternal(value) {
  assertExactObject(value, REQUEST_KEYS, 'builder_generation_request_invalid');
  const version = valueAt(value, 'version', 'builder_generation_request_invalid');
  const targetRevision = valueAt(value, 'target_revision', 'builder_generation_request_invalid');
  if (
    version !== BUILDER_GENERATION_REQUEST_PROTOCOL
    || !Number.isSafeInteger(targetRevision)
    || targetRevision < 1
  ) fail('builder_generation_request_invalid');

  const parent = sanitizeParent(valueAt(value, 'parent_revision', 'builder_generation_request_invalid'));
  if (
    (targetRevision === 1 && parent !== null)
    || (targetRevision > 1 && parent?.revision !== targetRevision - 1)
  ) fail('builder_generation_request_invalid');

  const unsigned = {
    version: BUILDER_GENERATION_REQUEST_PROTOCOL,
    idea: safeIdea(valueAt(value, 'idea', 'builder_generation_request_invalid')),
    project_id: safeProjectId(valueAt(value, 'project_id', 'builder_generation_request_invalid')),
    target_revision: targetRevision,
    parent_revision: parent,
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

function sanitizeParentRevisionRecord(value, request) {
  if (request.parent_revision === null) {
    if (value !== null) fail('builder_generation_parent_invalid');
    return null;
  }
  if (value === null || value === undefined) fail('builder_generation_parent_invalid');
  let record;
  try {
    record = sanitizeBuilderProjectRevisionRecord(value);
  } catch {
    fail('builder_generation_parent_invalid');
  }
  if (
    record.project_id !== request.project_id
    || record.revision !== request.parent_revision.revision
    || record.revision_digest !== request.parent_revision.revision_digest
  ) fail('builder_generation_parent_invalid');
  return record;
}

function promptInput(value) {
  assertExactObject(value, PROMPT_INPUT_KEYS, 'builder_generation_request_invalid');
  const request = sanitizeBuilderGenerationRequestInternal(
    valueAt(value, 'request', 'builder_generation_request_invalid'),
  );
  const parent = sanitizeParentRevisionRecord(
    valueAt(value, 'parent_revision_record', 'builder_generation_parent_invalid'),
    request,
  );
  return { request, parent };
}

function createBuilderGenerationPromptDescriptor(value) {
  try {
    const { request, parent } = promptInput(value);
    const userContext = {
      idea: request.idea,
      mode: parent === null ? 'create' : 'revise',
      target_revision: request.target_revision,
      current_project: parent === null ? null : {
        title: parent.title,
        summary: parent.summary,
        files: parent.files,
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
        exact_file_keys: [...OUTPUT_CONTRACT.exact_file_keys],
        format: OUTPUT_CONTRACT.format,
      },
      max_generated_text_bytes: MAX_GENERATED_TEXT_BYTES,
    };
    if (Buffer.byteLength(canonicalJson(descriptor, 'builder_generation_request_invalid'), 'utf8')
      > MAX_PROMPT_DESCRIPTOR_BYTES) {
      fail('builder_generation_parent_invalid');
    }
    return freezeDeep(descriptor);
  } catch (error) {
    if (error instanceof BuilderGenerationKernelError) throw error;
    fail('builder_generation_request_invalid');
  }
}

function sanitizeGeneratedProposal(value) {
  assertExactObject(value, PROPOSAL_KEYS, 'builder_generation_response_invalid');
  const files = valueAt(value, 'files', 'builder_generation_response_invalid');
  assertExactObject(files, FILE_KEYS, 'builder_generation_response_invalid');
  const proposal = {
    kind: valueAt(value, 'kind', 'builder_generation_response_invalid'),
    title: valueAt(value, 'title', 'builder_generation_response_invalid'),
    summary: valueAt(value, 'summary', 'builder_generation_response_invalid'),
    files: {
      'index.html': valueAt(files, 'index.html', 'builder_generation_response_invalid'),
      'styles.css': valueAt(files, 'styles.css', 'builder_generation_response_invalid'),
      'app.js': valueAt(files, 'app.js', 'builder_generation_response_invalid'),
    },
  };
  let proposalDigest;
  try {
    proposalDigest = digestBuilderProjectProposalRecord(proposal);
  } catch {
    fail('builder_generation_response_invalid');
  }
  return { proposal: freezeDeep(proposal), proposalDigest };
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
  ) fail('builder_generation_response_invalid');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail('builder_generation_response_invalid');
  }
  return sanitizeGeneratedProposal(parsed);
}

function projectBuilderGenerationResult(value) {
  try {
    assertExactObject(value, RESULT_INPUT_KEYS, 'builder_generation_request_invalid');
    const request = sanitizeBuilderGenerationRequestInternal(
      valueAt(value, 'request', 'builder_generation_request_invalid'),
    );
    sanitizeParentRevisionRecord(
      valueAt(value, 'parent_revision_record', 'builder_generation_parent_invalid'),
      request,
    );
    const { proposal, proposalDigest } = parseGeneratedText(
      valueAt(value, 'generated_text', 'builder_generation_response_invalid'),
    );
    return freezeDeep({
      version: BUILDER_GENERATION_RESULT_PROTOCOL,
      request_id: request.request_digest,
      proposal,
      evidence: {
        authority: BUILDER_CODE_GENERATOR_AUTHORITY,
        prompt_version: BUILDER_CODE_PROJECT_PROMPT_VERSION,
        request_version: BUILDER_GENERATION_REQUEST_PROTOCOL,
        result_version: BUILDER_GENERATION_RESULT_PROTOCOL,
        request_digest: request.request_digest,
        proposal_digest: proposalDigest,
        project_id: request.project_id,
        target_revision: request.target_revision,
        parent_revision: request.parent_revision === null ? null : { ...request.parent_revision },
      },
      admissions: {
        execution: 'not_evaluated',
        preview_script: 'not_authorized',
      },
    });
  } catch (error) {
    if (error instanceof BuilderGenerationKernelError) throw error;
    fail('builder_generation_response_invalid');
  }
}

module.exports = Object.freeze({
  BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION,
  MAX_GENERATED_TEXT_BYTES,
  BuilderGenerationKernelError,
  sanitizeBuilderGenerationRequest,
  createBuilderGenerationPromptDescriptor,
  projectBuilderGenerationResult,
});
