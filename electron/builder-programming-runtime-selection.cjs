'use strict';

const { types: utilTypes } = require('node:util');

const BUILDER_PROGRAMMING_RUNTIME_SELECTION_VERSION =
  'builder-programming-runtime-selection.v1';
const SELECT_KEYS = Object.freeze([
  'feature_flag',
  'harness_available',
  'provider_compatible',
]);

class BuilderProgrammingRuntimeSelectionError extends Error {
  constructor() {
    super('The programming runtime selection could not be verified.');
    this.name = 'BuilderProgrammingRuntimeSelectionError';
    this.code = 'builder_programming_runtime_selection_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderProgrammingRuntimeSelectionError();
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

function selectBuilderProgrammingRuntime(rawRequest) {
  const request = exactObject(rawRequest, SELECT_KEYS);
  const featureFlag = request.feature_flag;
  const harnessAvailable = request.harness_available;
  const providerCompatible = request.provider_compatible;
  if (
    !['disabled', 'shadow', 'enabled'].includes(featureFlag)
    || typeof harnessAvailable !== 'boolean'
    || typeof providerCompatible !== 'boolean'
  ) fail();
  const selected = featureFlag === 'enabled' && harnessAvailable && providerCompatible
    ? 'deepseek_harness.v1'
    : 'structured_operations.v1';
  return Object.freeze({
    selection_version: BUILDER_PROGRAMMING_RUNTIME_SELECTION_VERSION,
    selected_runtime: selected,
    feature_flag: featureFlag,
    fallback_active: selected === 'structured_operations.v1',
    shadow_evaluation: featureFlag === 'shadow' && harnessAvailable && providerCompatible,
    reason: featureFlag === 'disabled'
      ? 'feature_disabled'
      : !harnessAvailable
        ? 'runtime_unavailable'
        : !providerCompatible
          ? 'provider_incompatible'
          : featureFlag === 'shadow'
            ? 'shadow_only'
            : 'explicitly_enabled',
    authority: 'electron_main_owned_runtime_selection',
  });
}

module.exports = Object.freeze({
  BUILDER_PROGRAMMING_RUNTIME_SELECTION_VERSION,
  BuilderProgrammingRuntimeSelectionError,
  selectBuilderProgrammingRuntime,
});
