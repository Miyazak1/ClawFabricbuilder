'use strict';

const BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_POLICY_VERSION =
  'builder-programming-runtime-supervision-policy.v1';

const BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_DEFAULTS = Object.freeze({
  max_run_duration_ms: 60 * 60 * 1_000,
  runtime_idle_timeout_ms: 5 * 60 * 1_000,
  initialize_timeout_ms: 30_000,
  shutdown_timeout_ms: 5_000,
  shutdown_grace_ms: 5_000,
  eof_grace_ms: 1_000,
});

module.exports = Object.freeze({
  BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_POLICY_VERSION,
  BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_DEFAULTS,
});
