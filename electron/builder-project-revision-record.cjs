'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_PROJECT_PROPOSAL_KIND = 'builder_code_project';
const BUILDER_CODE_GENERATOR_AUTHORITY = 'builder_code_project_generator';
const BUILDER_CODE_PROJECT_PROMPT_VERSION_V1 = 'builder-code-project.v1';
const BUILDER_CODE_PROJECT_PROMPT_VERSION = 'builder-code-project.v2';
const BUILDER_GENERATION_REQUEST_PROTOCOL = 'builder-generation-request.v1';
const BUILDER_GENERATION_RESULT_PROTOCOL = 'builder-generation-result.v1';
const BUILDER_PROJECT_RECORD_KIND = 'builder_project_revision';
const BUILDER_PROJECT_SCHEMA_VERSION = 1;
const BUILDER_PROJECT_REVISION_INVALID_REASON = 'record_invalid';
const BUILDER_PROJECT_STATIC_PREVIEW_REASON = 'static_preview_contract_rejected';
const BUILDER_PROJECT_REVISION_ERROR_REASONS = new Set([
  BUILDER_PROJECT_REVISION_INVALID_REASON,
  BUILDER_PROJECT_STATIC_PREVIEW_REASON,
]);

const BUILDER_PROJECT_TOTAL_MAX_UTF8_BYTES = 512 * 1024;
const BUILDER_PROJECT_HTML_MAX_UTF8_BYTES = 256 * 1024;
const BUILDER_PROJECT_CSS_MAX_UTF8_BYTES = 128 * 1024;
const BUILDER_PROJECT_JS_MAX_UTF8_BYTES = 128 * 1024;
const MAX_RECORD_BYTES = BUILDER_PROJECT_TOTAL_MAX_UTF8_BYTES + 8 * 1024;

const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FORBIDDEN_JAVASCRIPT_MODULE_PATTERN = /\b(?:import|export)\b/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_ASSIGNMENT_PATTERN = /["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S/iu;
const AUTHORIZATION_VALUE_PATTERN = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}/iu;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^\s/:@]+:[^\s/@]+@/iu;
const COMMON_SECRET_VALUE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/u;
const UNSAFE_CSS_PATTERN = /(?:@import\b|@font-face\b|url\s*\(|image-set\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:|<\/style)/iu;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;

const ACTIVE_HTML_ELEMENTS = new Set([
  'script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form', 'template',
]);
const URL_OR_NAVIGATION_ATTRIBUTES = new Set([
  'action', 'download', 'formaction', 'href', 'ping', 'poster', 'src', 'srcset', 'target',
  'xlink:href',
]);

const FILE_KEYS = Object.freeze(['index.html', 'styles.css', 'app.js']);
const PARENT_KEYS = Object.freeze(['revision', 'revision_digest']);
const EVIDENCE_KEYS = Object.freeze([
  'authority',
  'prompt_version',
  'request_version',
  'result_version',
  'request_digest',
  'proposal_digest',
  'project_id',
  'target_revision',
  'parent_revision',
]);
const REVISION_KEYS = Object.freeze([
  'schema_version',
  'record_kind',
  'project_id',
  'revision',
  'revision_digest',
  'parent_revision',
  'title',
  'summary',
  'files',
  'proposal_evidence',
  'execution_admission',
  'preview_script_admission',
]);

class BuilderProjectRevisionRecordError extends Error {
  constructor(reason = BUILDER_PROJECT_REVISION_INVALID_REASON) {
    super('The local project version could not be verified.');
    this.name = 'BuilderProjectRevisionRecordError';
    this.code = 'builder_project_revision_invalid';
    this.reason = BUILDER_PROJECT_REVISION_ERROR_REASONS.has(reason)
      ? reason
      : BUILDER_PROJECT_REVISION_INVALID_REASON;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(reason) {
  throw new BuilderProjectRevisionRecordError(reason);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, expectedKeys) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
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
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
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
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code <= 0x1f && (!allowFormatting || ![0x09, 0x0a, 0x0d].includes(code))) return true;
  }
  return false;
}

function withinCodePointLimit(value, maximum) {
  return value.length <= maximum * 2 && Array.from(value).length <= maximum;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeDisplayText(value, maximum) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || !withinCodePointLimit(value, maximum)
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value, false)
  ) fail();
  return value;
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

function safeFileText(value, maximumBytes, allowEmpty) {
  if (
    typeof value !== 'string'
    || value.length > maximumBytes
    || (!allowEmpty && !value.trim())
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value, true)
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || containsUnsafeMaterial(value)
  ) fail();
  return value;
}

function decodedCssForSafety(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\\(?:\r\n|[\n\r\f])/gu, '')
    .replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?/giu, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return '\ufffd';
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/\\([^0-9a-f\n\r\f])/giu, '$1');
}

function unsafeCss(value) {
  return UNSAFE_CSS_PATTERN.test(decodedCssForSafety(value));
}

function isHtmlSpace(character) {
  return character === ' ' || character === '\t' || character === '\n'
    || character === '\r' || character === '\f';
}

function isHtmlNameCharacter(character) {
  return character !== undefined
    && !isHtmlSpace(character)
    && !['/', '>', '=', '"', "'", '<'].includes(character);
}

function skipHtmlSpace(value, start) {
  let index = start;
  while (index < value.length && isHtmlSpace(value[index])) index += 1;
  return index;
}

function readHtmlAttributeValue(value, start) {
  if (start >= value.length) fail();
  const quote = value[start];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, start + 1);
    if (end < 0) fail();
    return { end: end + 1, value: value.slice(start + 1, end) };
  }
  let end = start;
  while (end < value.length && !isHtmlSpace(value[end]) && value[end] !== '>') end += 1;
  if (end === start) fail();
  return { end, value: value.slice(start, end) };
}

function readHtmlTag(value, start) {
  let index = start + 1;
  let closing = false;
  if (value[index] === '/') {
    closing = true;
    index += 1;
  }
  index = skipHtmlSpace(value, index);
  const nameStart = index;
  while (index < value.length && isHtmlNameCharacter(value[index])) index += 1;
  if (index === nameStart) fail();
  const name = value.slice(nameStart, index).toLowerCase();
  if (ACTIVE_HTML_ELEMENTS.has(name)) fail(BUILDER_PROJECT_STATIC_PREVIEW_REASON);

  if (closing) {
    index = skipHtmlSpace(value, index);
    if (value[index] !== '>') fail();
    return { closing, end: index + 1, name };
  }

  while (index < value.length) {
    index = skipHtmlSpace(value, index);
    while (value[index] === '/' && value[index + 1] !== '>') {
      index = skipHtmlSpace(value, index + 1);
    }
    if (value[index] === '>') return { closing, end: index + 1, name };
    if (value[index] === '/' && value[index + 1] === '>') {
      return { closing, end: index + 2, name };
    }
    const attributeStart = index;
    while (index < value.length && isHtmlNameCharacter(value[index])) index += 1;
    if (index === attributeStart) fail();
    const attributeName = value.slice(attributeStart, index).toLowerCase();
    if (attributeName.startsWith('on')
      || attributeName === 'srcdoc'
      || attributeName.endsWith(':href')
      || URL_OR_NAVIGATION_ATTRIBUTES.has(attributeName)) {
      fail(BUILDER_PROJECT_STATIC_PREVIEW_REASON);
    }
    index = skipHtmlSpace(value, index);
    let attributeValue = '';
    if (value[index] === '=') {
      index = skipHtmlSpace(value, index + 1);
      const parsed = readHtmlAttributeValue(value, index);
      attributeValue = parsed.value;
      index = parsed.end;
    }
    if (attributeName === 'style' && unsafeCss(attributeValue)) {
      fail(BUILDER_PROJECT_STATIC_PREVIEW_REASON);
    }
  }
  fail();
}

function assertStaticHtml(value) {
  let index = 0;
  while (index < value.length) {
    const opening = value.indexOf('<', index);
    if (opening < 0) return;
    if (value.startsWith('<!--', opening)) {
      const commentEnd = value.indexOf('-->', opening + 4);
      if (commentEnd < 0) fail();
      index = commentEnd + 3;
      continue;
    }
    const remaining = value.slice(opening);
    const doctype = /^<!doctype\s+html\s*>/iu.exec(remaining);
    if (doctype) {
      index = opening + doctype[0].length;
      continue;
    }
    const next = value[opening + 1];
    if (next === undefined) return;
    if (!/[A-Za-z/]/u.test(next)) {
      if (next === '!' || next === '?') fail();
      index = opening + 1;
      continue;
    }
    const tag = readHtmlTag(value, opening);
    if (tag.name === 'style' && !tag.closing) {
      const closingPattern = /<\s*\/\s*style\s*>/giu;
      closingPattern.lastIndex = tag.end;
      const closing = closingPattern.exec(value);
      if (!closing || closing.index < tag.end) fail();
      if (unsafeCss(value.slice(tag.end, closing.index))) {
        fail(BUILDER_PROJECT_STATIC_PREVIEW_REASON);
      }
      index = closingPattern.lastIndex;
      continue;
    }
    if (tag.name === 'style' && tag.closing) fail();
    index = tag.end;
  }
}

function sanitizeParent(value) {
  if (value === null) return null;
  assertExactObject(value, PARENT_KEYS);
  const revision = valueAt(value, 'revision');
  if (!Number.isSafeInteger(revision) || revision < 1) fail();
  return {
    revision,
    revision_digest: safeDigest(valueAt(value, 'revision_digest')),
  };
}

function sameParent(left, right) {
  return left === null
    ? right === null
    : right !== null
      && left.revision === right.revision
      && left.revision_digest === right.revision_digest;
}

function sanitizeFiles(value) {
  assertExactObject(value, FILE_KEYS);
  const html = safeFileText(valueAt(value, 'index.html'), BUILDER_PROJECT_HTML_MAX_UTF8_BYTES, false);
  const css = safeFileText(valueAt(value, 'styles.css'), BUILDER_PROJECT_CSS_MAX_UTF8_BYTES, false);
  const javascript = safeFileText(valueAt(value, 'app.js'), BUILDER_PROJECT_JS_MAX_UTF8_BYTES, true);
  assertStaticHtml(html);
  if (unsafeCss(css) || FORBIDDEN_JAVASCRIPT_MODULE_PATTERN.test(javascript)) {
    fail(BUILDER_PROJECT_STATIC_PREVIEW_REASON);
  }
  return { 'index.html': html, 'styles.css': css, 'app.js': javascript };
}

function sanitizeEvidence(value) {
  assertExactObject(value, EVIDENCE_KEYS);
  const targetRevision = valueAt(value, 'target_revision');
  const promptVersion = valueAt(value, 'prompt_version');
  if (
    valueAt(value, 'authority') !== BUILDER_CODE_GENERATOR_AUTHORITY
    || (promptVersion !== BUILDER_CODE_PROJECT_PROMPT_VERSION_V1
      && promptVersion !== BUILDER_CODE_PROJECT_PROMPT_VERSION)
    || valueAt(value, 'request_version') !== BUILDER_GENERATION_REQUEST_PROTOCOL
    || valueAt(value, 'result_version') !== BUILDER_GENERATION_RESULT_PROTOCOL
    || !Number.isSafeInteger(targetRevision)
    || targetRevision < 1
  ) fail();
  return {
    authority: BUILDER_CODE_GENERATOR_AUTHORITY,
    prompt_version: promptVersion,
    request_version: BUILDER_GENERATION_REQUEST_PROTOCOL,
    result_version: BUILDER_GENERATION_RESULT_PROTOCOL,
    request_digest: safeDigest(valueAt(value, 'request_digest')),
    proposal_digest: safeDigest(valueAt(value, 'proposal_digest')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    target_revision: targetRevision,
    parent_revision: sanitizeParent(valueAt(value, 'parent_revision')),
  };
}

function proposalDigestBody(revision) {
  return {
    kind: BUILDER_PROJECT_PROPOSAL_KIND,
    title: revision.title,
    summary: revision.summary,
    files: revision.files,
  };
}

function sanitizedProposalDigestBody(value) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  const isProposal = keys.length === 4
    && keys.every((key) => typeof key === 'string' && ['kind', 'title', 'summary', 'files'].includes(key));
  const isRevision = keys.length === REVISION_KEYS.length
    && keys.every((key) => typeof key === 'string' && REVISION_KEYS.includes(key));
  if (!isProposal && !isRevision) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  if (isProposal && valueAt(value, 'kind') !== BUILDER_PROJECT_PROPOSAL_KIND) fail();
  const title = safeDisplayText(valueAt(value, 'title'), 80);
  const summary = safeDisplayText(valueAt(value, 'summary'), 400);
  if (containsUnsafeMaterial(title) || containsUnsafeMaterial(summary)) fail();
  return {
    kind: BUILDER_PROJECT_PROPOSAL_KIND,
    title,
    summary,
    files: sanitizeFiles(valueAt(value, 'files')),
  };
}

function sanitizedRevisionDigestBody(value) {
  assertExactObject(value, REVISION_KEYS);
  const revision = valueAt(value, 'revision');
  if (valueAt(value, 'schema_version') !== BUILDER_PROJECT_SCHEMA_VERSION
    || valueAt(value, 'record_kind') !== BUILDER_PROJECT_RECORD_KIND
    || valueAt(value, 'execution_admission') !== 'not_evaluated'
    || valueAt(value, 'preview_script_admission') !== 'not_authorized'
    || !Number.isSafeInteger(revision)
    || revision < 1) fail();
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const parentRevision = sanitizeParent(valueAt(value, 'parent_revision'));
  if ((revision === 1 && parentRevision !== null)
    || (revision > 1 && parentRevision?.revision !== revision - 1)) fail();
  const proposal = sanitizedProposalDigestBody(value);
  const evidence = sanitizeEvidence(valueAt(value, 'proposal_evidence'));
  if (evidence.project_id !== projectId
    || evidence.target_revision !== revision
    || !sameParent(evidence.parent_revision, parentRevision)
    || evidence.proposal_digest !== sha256Canonical(proposal)) fail();
  return revisionDigestBody({
    schema_version: BUILDER_PROJECT_SCHEMA_VERSION,
    record_kind: BUILDER_PROJECT_RECORD_KIND,
    project_id: projectId,
    revision,
    parent_revision: parentRevision,
    title: proposal.title,
    summary: proposal.summary,
    files: proposal.files,
    proposal_evidence: evidence,
    execution_admission: 'not_evaluated',
    preview_script_admission: 'not_authorized',
  });
}

function revisionDigestBody(revision) {
  return {
    execution_admission: revision.execution_admission,
    files: revision.files,
    parent_revision: revision.parent_revision,
    preview_script_admission: revision.preview_script_admission,
    project_id: revision.project_id,
    proposal_evidence: revision.proposal_evidence,
    record_kind: revision.record_kind,
    revision: revision.revision,
    schema_version: revision.schema_version,
    summary: revision.summary,
    title: revision.title,
  };
}

function digestBuilderProjectProposalRecord(revision) {
  return sha256Canonical(sanitizedProposalDigestBody(revision));
}

function digestBuilderProjectRevisionRecord(revision) {
  return sha256Canonical(sanitizedRevisionDigestBody(revision));
}

function sanitizeBuilderProjectRevisionRecord(value) {
  assertExactObject(value, REVISION_KEYS);
  const revision = valueAt(value, 'revision');
  if (
    valueAt(value, 'schema_version') !== BUILDER_PROJECT_SCHEMA_VERSION
    || valueAt(value, 'record_kind') !== BUILDER_PROJECT_RECORD_KIND
    || valueAt(value, 'execution_admission') !== 'not_evaluated'
    || valueAt(value, 'preview_script_admission') !== 'not_authorized'
    || !Number.isSafeInteger(revision)
    || revision < 1
  ) fail();

  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const revisionDigest = safeDigest(valueAt(value, 'revision_digest'));
  const parentRevision = sanitizeParent(valueAt(value, 'parent_revision'));
  if ((revision === 1 && parentRevision !== null)
    || (revision > 1 && parentRevision?.revision !== revision - 1)) fail();

  const title = safeDisplayText(valueAt(value, 'title'), 80);
  const summary = safeDisplayText(valueAt(value, 'summary'), 400);
  if (containsUnsafeMaterial(title) || containsUnsafeMaterial(summary)) fail();
  const files = sanitizeFiles(valueAt(value, 'files'));
  const evidence = sanitizeEvidence(valueAt(value, 'proposal_evidence'));
  if (
    evidence.project_id !== projectId
    || evidence.target_revision !== revision
    || !sameParent(evidence.parent_revision, parentRevision)
  ) fail();

  const unsigned = {
    schema_version: BUILDER_PROJECT_SCHEMA_VERSION,
    record_kind: BUILDER_PROJECT_RECORD_KIND,
    project_id: projectId,
    revision,
    parent_revision: parentRevision,
    title,
    summary,
    files,
    proposal_evidence: evidence,
    execution_admission: 'not_evaluated',
    preview_script_admission: 'not_authorized',
  };
  if (
    Buffer.byteLength(JSON.stringify(proposalDigestBody(unsigned)), 'utf8')
      > BUILDER_PROJECT_TOTAL_MAX_UTF8_BYTES
    || sha256Canonical(proposalDigestBody(unsigned)) !== evidence.proposal_digest
    || sha256Canonical(revisionDigestBody(unsigned)) !== revisionDigest
  ) fail();
  return freezeDeep({ ...unsigned, revision_digest: revisionDigest });
}

function serializeBuilderProjectRevisionRecord(value) {
  const record = sanitizeBuilderProjectRevisionRecord(value);
  const serialized = `${canonicalJson(record)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) fail();
  return serialized;
}

function safeBoundary(fn) {
  return (...args) => {
    try { return fn(...args); } catch (error) {
      if (error instanceof BuilderProjectRevisionRecordError) throw error;
      fail();
    }
  };
}

module.exports = Object.freeze({
  BUILDER_PROJECT_RECORD_KIND,
  BUILDER_PROJECT_SCHEMA_VERSION,
  BUILDER_PROJECT_REVISION_INVALID_REASON,
  BUILDER_PROJECT_STATIC_PREVIEW_REASON,
  MAX_RECORD_BYTES,
  BuilderProjectRevisionRecordError,
  digestBuilderProjectProposalRecord: safeBoundary(digestBuilderProjectProposalRecord),
  digestBuilderProjectRevisionRecord: safeBoundary(digestBuilderProjectRevisionRecord),
  sanitizeBuilderProjectRevisionRecord: safeBoundary(sanitizeBuilderProjectRevisionRecord),
  serializeBuilderProjectRevisionRecord: safeBoundary(serializeBuilderProjectRevisionRecord),
});
