'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_PROJECT_SOURCE_TREE_VERSION = 'builder-project-source-tree.v1';
const BUILDER_PROJECT_SOURCE_ENTRY_KIND = 'text_file';
const MAX_SOURCE_FILES = 512;
const MAX_SOURCE_PATH_CODE_POINTS = 240;
const MAX_SOURCE_PATH_UTF8_BYTES = 1_024;
const MAX_SOURCE_PATH_SEGMENT_CODE_POINTS = 120;
const MAX_SOURCE_FILE_UTF8_BYTES = 512 * 1_024;
const MAX_SOURCE_TREE_UTF8_BYTES = 4 * 1_024 * 1_024;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const AUTHORIZATION_VALUE_PATTERN = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}/iu;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^\s/:@]+:[^\s/@]+@/iu;
const KNOWN_TOKEN_SECRET_VALUE_PATTERN =
  /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/gu;
const HIGH_CONFIDENCE_SECRET_ASSIGNMENT_PATTERNS = Object.freeze([
  /(?:^|[\r\n;,{])\s*(?:(?:export\s+)?(?:const|let|var)\s+)?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*(["'`]?)([A-Za-z0-9._~+/=-]{16,})\1/gimu,
  /(?:^|[\r\n;,])\s*(?:[A-Za-z_$][A-Za-z0-9_$]*\s*\.\s*)+(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)\s*=\s*(["'`]?)([A-Za-z0-9._~+/=-]{16,})\1/gimu,
  /(?:^|[\r\n;,])\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*\s*\[\s*["'](?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)["']\s*\]\s*=\s*(["'`]?)([A-Za-z0-9._~+/=-]{16,})\1/gimu,
]);
const PLACEHOLDER_SECRET_PATTERN =
  /^(?:(?:sk-(?:ant-)?)?(?:replace[-_ ]?me|your[-_ ]?(?:api[-_ ]?)?key|example(?:[-_ ]?(?:api[-_ ]?)?key)?|placeholder|change[-_ ]?me|dummy|sample|test[-_ ]?(?:api[-_ ]?)?key|x{8,}|0{8,}))(?:[-_ ]?(?:please|here|value))?$/iu;
const WINDOWS_INVALID_PATH_CHARACTER_PATTERN = /[<>:"|?*]/u;

const SOURCE_TREE_KEYS = Object.freeze(['source_tree_version', 'files', 'source_tree_digest']);
const SOURCE_ENTRY_KEYS = Object.freeze(['path', 'entry_kind', 'content', 'content_digest']);
const CREATE_ENTRY_KEYS = Object.freeze(['path', 'content']);
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

class BuilderProjectSourceTreeError extends Error {
  constructor() {
    super('The project source tree could not be verified.');
    this.name = 'BuilderProjectSourceTreeError';
    this.code = 'builder_project_source_tree_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderProjectSourceTreeError();
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

function assertDenseArray(value, maximum) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximum) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) fail();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  const expectedKeyCount = value.length + 1;
  if (keys.length !== expectedKeyCount || !keys.includes('length')) fail();
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
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
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

function containsHighConfidenceSecret(value) {
  if (value.length > MAX_SOURCE_FILE_UTF8_BYTES) return true;
  const normalized = value.normalize('NFKC');
  if (
    PRIVATE_KEY_PATTERN.test(normalized)
    || AUTHORIZATION_VALUE_PATTERN.test(normalized)
    || CREDENTIAL_URL_PATTERN.test(normalized)
  ) return true;
  for (const match of normalized.matchAll(KNOWN_TOKEN_SECRET_VALUE_PATTERN)) {
    if (!PLACEHOLDER_SECRET_PATTERN.test(match[0])) return true;
  }
  for (const pattern of HIGH_CONFIDENCE_SECRET_ASSIGNMENT_PATTERNS) {
    for (const match of normalized.matchAll(pattern)) {
      if (!PLACEHOLDER_SECRET_PATTERN.test(match[2])) return true;
    }
  }
  return false;
}

function safeDigest(value) {
  if (typeof value !== 'string' || value.length !== 71 || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_SOURCE_PATH_CODE_POINTS * 2
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value, false)
    || !withinCodePointLimit(value, MAX_SOURCE_PATH_CODE_POINTS)
    || Buffer.byteLength(value, 'utf8') > MAX_SOURCE_PATH_UTF8_BYTES
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || /^[A-Za-z]:/u.test(value)
    || value.startsWith('//')
  ) fail();

  const segments = value.split('/');
  if (segments.length === 0) fail();
  for (const segment of segments) {
    if (
      segment.length === 0
      || segment === '.'
      || segment === '..'
      || segment.endsWith('.')
      || segment.endsWith(' ')
      || WINDOWS_INVALID_PATH_CHARACTER_PATTERN.test(segment)
      || !withinCodePointLimit(segment, MAX_SOURCE_PATH_SEGMENT_CODE_POINTS)
    ) fail();
    const basename = segment.split('.')[0].normalize('NFKC').toLowerCase();
    if (WINDOWS_RESERVED_NAMES.has(basename)) fail();
  }
  return value;
}

function pathComparisonKey(value) {
  return value.normalize('NFKC').toUpperCase();
}

function safeContent(value) {
  if (
    typeof value !== 'string'
    || value.length > MAX_SOURCE_FILE_UTF8_BYTES
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value, true)
    || Buffer.byteLength(value, 'utf8') > MAX_SOURCE_FILE_UTF8_BYTES
    || containsHighConfidenceSecret(value)
  ) fail();
  return value;
}

function sourceEntryDigestBody(entry) {
  return {
    content: entry.content,
    entry_kind: entry.entry_kind,
    path: entry.path,
  };
}

function sourceTreeDigestBody(tree) {
  return {
    files: tree.files,
    source_tree_version: tree.source_tree_version,
  };
}

function createEntry(path, content) {
  const safe = {
    path: safePath(path),
    entry_kind: BUILDER_PROJECT_SOURCE_ENTRY_KIND,
    content: safeContent(content),
  };
  return { ...safe, content_digest: sha256Canonical(sourceEntryDigestBody(safe)) };
}

function sanitizeSourceEntry(value) {
  assertExactObject(value, SOURCE_ENTRY_KEYS);
  if (valueAt(value, 'entry_kind') !== BUILDER_PROJECT_SOURCE_ENTRY_KIND) fail();
  const safe = {
    path: safePath(valueAt(value, 'path')),
    entry_kind: BUILDER_PROJECT_SOURCE_ENTRY_KIND,
    content: safeContent(valueAt(value, 'content')),
  };
  const digest = safeDigest(valueAt(value, 'content_digest'));
  if (sha256Canonical(sourceEntryDigestBody(safe)) !== digest) fail();
  return { ...safe, content_digest: digest };
}

function sanitizeFiles(value, createMode) {
  assertDenseArray(value, MAX_SOURCE_FILES);
  const files = [];
  let totalBytes = 0;
  for (const entry of value) {
    let file;
    if (!createMode) {
      file = sanitizeSourceEntry(entry);
    } else {
      assertExactObject(entry, CREATE_ENTRY_KEYS);
      file = createEntry(valueAt(entry, 'path'), valueAt(entry, 'content'));
    }
    totalBytes += Buffer.byteLength(file.content, 'utf8');
    if (totalBytes > MAX_SOURCE_TREE_UTF8_BYTES) fail();
    files.push(file);
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const comparisonKeys = new Set();
  for (const file of files) {
    const key = pathComparisonKey(file.path);
    if (comparisonKeys.has(key)) fail();
    comparisonKeys.add(key);
  }
  return files;
}

function createBuilderProjectSourceTree(value) {
  assertExactObject(value, ['files']);
  const files = sanitizeFiles(valueAt(value, 'files'), true);
  const unsigned = {
    source_tree_version: BUILDER_PROJECT_SOURCE_TREE_VERSION,
    files,
  };
  return freezeDeep({
    ...unsigned,
    source_tree_digest: sha256Canonical(sourceTreeDigestBody(unsigned)),
  });
}

function sanitizeBuilderProjectSourceTree(value) {
  assertExactObject(value, SOURCE_TREE_KEYS);
  if (valueAt(value, 'source_tree_version') !== BUILDER_PROJECT_SOURCE_TREE_VERSION) fail();
  const files = sanitizeFiles(valueAt(value, 'files'), false);
  const unsigned = {
    source_tree_version: BUILDER_PROJECT_SOURCE_TREE_VERSION,
    files,
  };
  const digest = safeDigest(valueAt(value, 'source_tree_digest'));
  if (sha256Canonical(sourceTreeDigestBody(unsigned)) !== digest) fail();
  return freezeDeep({ ...unsigned, source_tree_digest: digest });
}

function digestBuilderProjectSourceTree(value) {
  return sanitizeBuilderProjectSourceTree(value).source_tree_digest;
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderProjectSourceTreeError) throw error;
      fail();
    }
  };
}

module.exports = Object.freeze({
  BUILDER_PROJECT_SOURCE_TREE_VERSION,
  BUILDER_PROJECT_SOURCE_ENTRY_KIND,
  MAX_SOURCE_FILES,
  MAX_SOURCE_PATH_CODE_POINTS,
  MAX_SOURCE_PATH_UTF8_BYTES,
  MAX_SOURCE_FILE_UTF8_BYTES,
  MAX_SOURCE_TREE_UTF8_BYTES,
  BuilderProjectSourceTreeError,
  createBuilderProjectSourceTree: safeBoundary(createBuilderProjectSourceTree),
  digestBuilderProjectSourceTree: safeBoundary(digestBuilderProjectSourceTree),
  sanitizeBuilderProjectSourceTree: safeBoundary(sanitizeBuilderProjectSourceTree),
});
