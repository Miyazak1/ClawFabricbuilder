'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderProjectSourceTreeError,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_PROJECT_ADAPTER_ADMISSION_VERSION = 'builder-project-adapter-admission.v1';
const STATIC_WEB_PREVIEW_ADAPTER_ID = 'static_web_preview.v1';

const INPUT_KEYS = Object.freeze(['source_tree', 'adapter_id']);
const SANITIZE_INPUT_KEYS = Object.freeze(['source_tree', 'admission']);
const RESULT_KEYS = Object.freeze([
  'admission_version',
  'source_tree_digest',
  'adapter_id',
  'compatibility',
  'preview_admission',
  'execution_admission',
  'reason',
  'evidence_digest',
]);
const STATIC_WEB_PATHS = new Set(['index.html', 'styles.css', 'app.js']);
const ACTIVE_HTML_ELEMENT_PATTERN =
  /<\s*\/?\s*(?:script|style|iframe|object|embed|base|meta|link|form|template|foreignobject)\b/iu;
const EVENT_HANDLER_ATTRIBUTE_PATTERN = /\s+on[a-z0-9_-]+\s*=/iu;
const INLINE_STYLE_ATTRIBUTE_PATTERN = /\s+style\s*=/iu;
const URL_ATTRIBUTE_PATTERN =
  /\s+(?:action|download|formaction|href|ping|poster|src|srcset|target|xlink:href)\s*=/iu;
const UNSAFE_HTML_SCHEME_PATTERN = /\b(?:javascript|data|vbscript)\s*:/iu;
const UNSAFE_CSS_PATTERN = /(?:\\|@|\/\*|\*\/|\burl\b|\bimage-set\b|\bexpression\b|\bbehavior\s*:|-moz-binding\s*:|[<>])/iu;

class BuilderProjectAdapterAdmissionError extends Error {
  constructor() {
    super('The project adapter admission could not be verified.');
    this.name = 'BuilderProjectAdapterAdmissionError';
    this.code = 'builder_project_adapter_admission_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderProjectAdapterAdmissionError();
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
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function admissionDigestBody(value) {
  return {
    adapter_id: value.adapter_id,
    admission_version: value.admission_version,
    compatibility: value.compatibility,
    execution_admission: value.execution_admission,
    preview_admission: value.preview_admission,
    reason: value.reason,
    source_tree_digest: value.source_tree_digest,
  };
}

function staticWebAdmission(sourceTree) {
  const files = new Map(sourceTree.files.map((file) => [file.path, file.content]));
  if (
    !files.has('index.html')
    || [...files.keys()].some((filePath) => !STATIC_WEB_PATHS.has(filePath))
  ) {
    return {
      compatibility: 'unsupported',
      preview_admission: 'not_eligible',
      reason: 'source_shape_not_supported',
    };
  }

  const html = files.get('index.html');
  const css = files.get('styles.css') || '';
  if (
    ACTIVE_HTML_ELEMENT_PATTERN.test(html)
    || EVENT_HANDLER_ATTRIBUTE_PATTERN.test(html)
    || INLINE_STYLE_ATTRIBUTE_PATTERN.test(html)
    || URL_ATTRIBUTE_PATTERN.test(html)
    || UNSAFE_HTML_SCHEME_PATTERN.test(html)
    || UNSAFE_CSS_PATTERN.test(css)
  ) {
    return {
      compatibility: 'unsupported',
      preview_admission: 'not_eligible',
      reason: 'preview_contract_rejected',
    };
  }
  return {
    compatibility: 'supported',
    preview_admission: 'eligible',
    reason: 'static_web_source_supported',
  };
}

function evaluateBuilderProjectAdapterAdmission(value) {
  assertExactObject(value, INPUT_KEYS);
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  const adapterId = valueAt(value, 'adapter_id');
  if (adapterId !== null && adapterId !== STATIC_WEB_PREVIEW_ADAPTER_ID) fail();

  const decision = adapterId === null
    ? {
      compatibility: 'unsupported',
      preview_admission: 'not_eligible',
      reason: 'adapter_not_selected',
    }
    : staticWebAdmission(sourceTree);
  const unsigned = {
    admission_version: BUILDER_PROJECT_ADAPTER_ADMISSION_VERSION,
    source_tree_digest: sourceTree.source_tree_digest,
    adapter_id: adapterId,
    compatibility: decision.compatibility,
    preview_admission: decision.preview_admission,
    execution_admission: 'not_evaluated',
    reason: decision.reason,
  };
  return freezeDeep({
    ...unsigned,
    evidence_digest: sha256Canonical(admissionDigestBody(unsigned)),
  });
}

function sanitizeAdmissionRecord(value) {
  assertExactObject(value, RESULT_KEYS);
  const adapterId = valueAt(value, 'adapter_id');
  if (
    valueAt(value, 'admission_version') !== BUILDER_PROJECT_ADAPTER_ADMISSION_VERSION
    || (adapterId !== null && adapterId !== STATIC_WEB_PREVIEW_ADAPTER_ID)
    || !['supported', 'unsupported'].includes(valueAt(value, 'compatibility'))
    || !['eligible', 'not_eligible'].includes(valueAt(value, 'preview_admission'))
    || valueAt(value, 'execution_admission') !== 'not_evaluated'
    || ![
      'adapter_not_selected',
      'source_shape_not_supported',
      'preview_contract_rejected',
      'static_web_source_supported',
    ].includes(valueAt(value, 'reason'))
  ) fail();
  const unsigned = {
    admission_version: BUILDER_PROJECT_ADAPTER_ADMISSION_VERSION,
    source_tree_digest: valueAt(value, 'source_tree_digest'),
    adapter_id: adapterId,
    compatibility: valueAt(value, 'compatibility'),
    preview_admission: valueAt(value, 'preview_admission'),
    execution_admission: 'not_evaluated',
    reason: valueAt(value, 'reason'),
  };
  if (
    typeof unsigned.source_tree_digest !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(unsigned.source_tree_digest)
    || (
      (unsigned.compatibility === 'supported')
      !== (unsigned.preview_admission === 'eligible'
        && unsigned.reason === 'static_web_source_supported')
    )
    || (adapterId === null) !== (unsigned.reason === 'adapter_not_selected')
  ) fail();
  const digest = valueAt(value, 'evidence_digest');
  if (
    typeof digest !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(digest)
    || sha256Canonical(admissionDigestBody(unsigned)) !== digest
  ) fail();
  return { ...unsigned, evidence_digest: digest };
}

function sanitizeBuilderProjectAdapterAdmission(value) {
  assertExactObject(value, SANITIZE_INPUT_KEYS);
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  const supplied = sanitizeAdmissionRecord(valueAt(value, 'admission'));
  const evaluated = evaluateBuilderProjectAdapterAdmission({
    source_tree: sourceTree,
    adapter_id: supplied.adapter_id,
  });
  if (canonicalJson(supplied) !== canonicalJson(evaluated)) fail();
  return evaluated;
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderProjectAdapterAdmissionError) throw error;
      if (error instanceof BuilderProjectSourceTreeError) fail();
      fail();
    }
  };
}

module.exports = Object.freeze({
  BUILDER_PROJECT_ADAPTER_ADMISSION_VERSION,
  STATIC_WEB_PREVIEW_ADAPTER_ID,
  BuilderProjectAdapterAdmissionError,
  evaluateBuilderProjectAdapterAdmission: safeBoundary(evaluateBuilderProjectAdapterAdmission),
  sanitizeBuilderProjectAdapterAdmission: safeBoundary(sanitizeBuilderProjectAdapterAdmission),
});
