'use strict';

const { types: utilTypes } = require('node:util');

const {
  createBuilderCodeChangeCandidate,
} = require('./builder-code-change-kernel.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_HARNESS_CANDIDATE_PROJECTOR_VERSION =
  'builder-harness-candidate-projector.v1';
const PROJECT_KEYS = Object.freeze([
  'conversation_events',
  'turn_id',
  'run_id',
  'base_revision_evidence',
  'base_source_tree',
  'resulting_source_tree',
]);

class BuilderHarnessCandidateProjectorError extends Error {
  constructor(code = 'builder_harness_candidate_projection_invalid') {
    const selected = [
      'builder_harness_candidate_projection_invalid',
      'builder_harness_candidate_projection_unchanged',
    ].includes(code) ? code : 'builder_harness_candidate_projection_invalid';
    const messages = {
      builder_harness_candidate_projection_invalid: 'The Harness working result could not be verified.',
      builder_harness_candidate_projection_unchanged: 'The Harness coding run did not change project files.',
    };
    super(messages[selected]);
    this.name = 'BuilderHarnessCandidateProjectorError';
    this.code = selected;
    this.retryable = selected === 'builder_harness_candidate_projection_unchanged';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderHarnessCandidateProjectorError(code);
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

function pathKey(value) {
  return value.normalize('NFKC').toUpperCase();
}

function operationsBetween(baseSourceTree, resultingSourceTree) {
  const baseByPath = new Map(baseSourceTree.files.map((file) => [pathKey(file.path), file]));
  const resultingByPath = new Map(
    resultingSourceTree.files.map((file) => [pathKey(file.path), file]),
  );
  const operations = [];
  for (const file of baseSourceTree.files) {
    if (!resultingByPath.has(pathKey(file.path))) {
      operations.push({ operation: 'delete', path: file.path, content: null });
    }
  }
  for (const file of resultingSourceTree.files) {
    const before = baseByPath.get(pathKey(file.path));
    if (
      before === undefined
      || before.path !== file.path
      || before.content_digest !== file.content_digest
    ) {
      operations.push({ operation: 'upsert', path: file.path, content: file.content });
    }
  }
  operations.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (operations.length === 0) fail('builder_harness_candidate_projection_unchanged');
  return operations;
}

function projectBuilderHarnessCandidate(rawRequest) {
  try {
    const request = exactObject(rawRequest, PROJECT_KEYS);
    const baseSourceTree = sanitizeBuilderProjectSourceTree(valueAt(request, 'base_source_tree'));
    const resultingSourceTree = sanitizeBuilderProjectSourceTree(
      valueAt(request, 'resulting_source_tree'),
    );
    const candidate = createBuilderCodeChangeCandidate({
      conversation_events: valueAt(request, 'conversation_events'),
      turn_id: valueAt(request, 'turn_id'),
      run_id: valueAt(request, 'run_id'),
      base_revision_evidence: valueAt(request, 'base_revision_evidence'),
      base_source_tree: baseSourceTree,
      operations: operationsBetween(baseSourceTree, resultingSourceTree),
    });
    if (candidate.resulting_tree_digest !== resultingSourceTree.source_tree_digest) fail();
    return candidate;
  } catch (error) {
    if (error instanceof BuilderHarnessCandidateProjectorError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_HARNESS_CANDIDATE_PROJECTOR_VERSION,
  BuilderHarnessCandidateProjectorError,
  projectBuilderHarnessCandidate,
});
