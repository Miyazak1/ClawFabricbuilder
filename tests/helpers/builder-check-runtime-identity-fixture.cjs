'use strict';

const {
  sha256Canonical,
} = require('../../electron/builder-git-receipt-contract.cjs');

const AUTHORITY = Object.freeze({
  identity_authority: 'main_owned_verified_runtime_files_v1',
  path_authority: 'private_registry_only',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: false,
  command_execution: false,
  source_read: 'runtime_files_only',
  source_write: 'not_present',
  git_write: false,
  sqlite_write: false,
  save_authority: false,
  network_authority: 'not_present',
});

function checkRuntimeIdentity(overrides = {}) {
  const unsigned = {
    runtime_identity_version: 'builder-check-runtime-identity.v1',
    package_manager: 'npm',
    launcher_kind: 'node_cli',
    launcher_binary_digest: `sha256:${'a'.repeat(64)}`,
    cli_entry_digest: `sha256:${'b'.repeat(64)}`,
    package_manager_version: '10.9.2',
    resolution_source: 'verified_external_runtime',
    resolved_at_ms: 90,
    expires_at_ms: 300_100,
    status: 'ready',
    authority: { ...AUTHORITY },
    ...overrides,
  };
  const digest = sha256Canonical(unsigned);
  return Object.freeze({
    ...unsigned,
    runtime_identity_id: `builder-check-runtime-identity:${digest.slice('sha256:'.length)}`,
    runtime_identity_digest: digest,
  });
}

module.exports = Object.freeze({ checkRuntimeIdentity });
