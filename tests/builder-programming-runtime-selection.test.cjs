'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BuilderProgrammingRuntimeSelectionError,
  selectBuilderProgrammingRuntime,
} = require('../electron/builder-programming-runtime-selection.cjs');

test('keeps the structured runtime when main explicitly disables Harness', () => {
  const result = selectBuilderProgrammingRuntime({
    feature_flag: 'disabled',
    harness_available: true,
    provider_compatible: true,
  });
  assert.equal(result.selected_runtime, 'structured_operations.v1');
  assert.equal(result.reason, 'feature_disabled');
  assert.equal(result.fallback_active, true);
});

test('selects Harness only when main explicitly enables an available compatible runtime', () => {
  const result = selectBuilderProgrammingRuntime({
    feature_flag: 'enabled',
    harness_available: true,
    provider_compatible: true,
  });
  assert.equal(result.selected_runtime, 'deepseek_harness.v1');
  assert.equal(result.reason, 'explicitly_enabled');
  assert.equal(result.fallback_active, false);
  assert.equal(result.authority, 'electron_main_owned_runtime_selection');
});

test('shadow mode never changes the user-facing runtime', () => {
  const result = selectBuilderProgrammingRuntime({
    feature_flag: 'shadow',
    harness_available: true,
    provider_compatible: true,
  });
  assert.equal(result.selected_runtime, 'structured_operations.v1');
  assert.equal(result.shadow_evaluation, true);
  assert.equal(result.reason, 'shadow_only');
});

test('fails closed for unavailable, incompatible, and malformed selections', () => {
  assert.equal(selectBuilderProgrammingRuntime({
    feature_flag: 'enabled',
    harness_available: false,
    provider_compatible: true,
  }).reason, 'runtime_unavailable');
  assert.equal(selectBuilderProgrammingRuntime({
    feature_flag: 'enabled',
    harness_available: true,
    provider_compatible: false,
  }).reason, 'provider_incompatible');
  assert.throws(
    () => selectBuilderProgrammingRuntime({
      feature_flag: 'force',
      harness_available: true,
      provider_compatible: true,
    }),
    BuilderProgrammingRuntimeSelectionError,
  );
});
