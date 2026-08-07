'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  BuilderProviderCapabilityManifestError,
  admitBuilderProviderCapabilities,
  createBuilderProviderCapabilityManifest,
  sanitizeBuilderProviderCapabilityAdmission,
  sanitizeBuilderProviderCapabilityManifest,
} = require('../electron/builder-provider-capability-manifest.cjs');

function secretRef() {
  return {
    ref_version: 'builder-provider-secret-ref.v1',
    provider_id: 'builder-default',
    secret_id: 'builder-provider-secret:default',
  };
}

function providerConfig(overrides = {}) {
  return createBuilderProviderConfig({
    base_url: 'https://api.example/v1',
    model: 'builder-model',
    timeout_ms: 60000,
    temperature: 0.2,
    max_tokens: 8192,
    secret_ref: secretRef(),
    ...overrides,
  });
}

function manifest(overrides = {}) {
  return createBuilderProviderCapabilityManifest({
    provider_config: providerConfig(overrides.provider_config_overrides ?? {}),
    protocol_family: 'openai_chat_completions.v1',
    assessed_at_ms: 10,
    ...overrides,
  });
}

test('creates a deterministic redacted capability manifest for the current Chat Completions adapter', () => {
  const first = manifest();
  const second = manifest();

  assert.deepEqual(first, second);
  assert.equal(first.result_version, 'builder-provider-capability-manifest.v1');
  assert.match(first.manifest_id, /^builder-provider-capability-manifest:[0-9a-f]{64}$/u);
  assert.equal(first.display_name, 'OpenAI-compatible Chat Completions');
  assert.equal(first.protocol_family, 'openai_chat_completions.v1');
  assert.equal(first.base_url_policy, 'https_or_loopback_http');
  assert.equal(first.model_id, 'builder-model');
  assert.equal(first.streaming, true);
  assert.equal(first.json_output, true);
  assert.equal(first.tool_calling, false);
  assert.equal(first.reasoning_output, false);
  assert.equal(first.prompt_cache_reporting, false);
  assert.equal(first.hosted_conversation_state, false);
  assert.equal(first.max_input_tokens, null);
  assert.equal(first.max_output_tokens, 8192);
  assert.equal(first.timeout_ms, 60000);
  assert.deepEqual(first.retry_policy, {
    max_attempts: 1,
    retryable_errors: ['timeout', 'transport_error', 'provider_unavailable'],
  });
  assert.equal(first.authority.provider_dispatch, 'not_performed');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.retry_policy), true);
  assert.equal(Object.isFrozen(first.known_limitations), true);
  assert.deepEqual(sanitizeBuilderProviderCapabilityManifest(structuredClone(first)), first);
  assert.doesNotMatch(
    JSON.stringify(first),
    /api\.example|builder-provider-secret|secret_ref|credential_(?:secret|value)|api[_-]?key|Bearer|provider-key/iu,
  );
});

test('admits only capabilities supported by the manifest and binds provider digest freshness', () => {
  const config = providerConfig();
  const current = createBuilderProviderCapabilityManifest({
    provider_config: config,
    protocol_family: 'openai_chat_completions.v1',
    assessed_at_ms: 10,
  });

  const admission = admitBuilderProviderCapabilities({
    provider_capability_manifest: current,
    required_capabilities: ['json_output', 'streaming'],
    expected_provider_config_digest: config.config_digest,
    assessed_at_ms: 11,
  });

  assert.equal(admission.result_version, 'builder-provider-capability-admission.v1');
  assert.match(admission.admission_id, /^builder-provider-capability-admission:[0-9a-f]{64}$/u);
  assert.equal(admission.provider_capability_manifest_id, current.manifest_id);
  assert.equal(admission.provider_config_digest, config.config_digest);
  assert.equal(admission.protocol_family, 'openai_chat_completions.v1');
  assert.deepEqual(admission.required_capabilities, ['json_output', 'streaming']);
  assert.equal(admission.capability_status, 'ready');
  assert.equal(admission.authority.provider_dispatch, 'not_performed');
  assert.deepEqual(sanitizeBuilderProviderCapabilityAdmission(structuredClone(admission)), admission);

  for (const required of [
    ['tool_calling'],
    ['reasoning_output'],
    ['prompt_cache_reporting'],
    ['hosted_conversation_state'],
  ]) {
    assert.throws(
      () => admitBuilderProviderCapabilities({
        provider_capability_manifest: current,
        required_capabilities: required,
        expected_provider_config_digest: config.config_digest,
        assessed_at_ms: 11,
      }),
      BuilderProviderCapabilityManifestError,
    );
  }

  assert.throws(
    () => admitBuilderProviderCapabilities({
      provider_capability_manifest: current,
      required_capabilities: ['json_output'],
      expected_provider_config_digest: `sha256:${'f'.repeat(64)}`,
      assessed_at_ms: 11,
    }),
    BuilderProviderCapabilityManifestError,
  );
});

test('fails closed for unsupported protocols, forged manifests, malformed capabilities, and stale assessment', () => {
  assert.throws(
    () => manifest({ protocol_family: 'openai_responses.v1' }),
    BuilderProviderCapabilityManifestError,
  );
  assert.throws(
    () => manifest({ assessed_at_ms: -1 }),
    BuilderProviderCapabilityManifestError,
  );

  const current = manifest();
  assert.throws(
    () => sanitizeBuilderProviderCapabilityManifest({
      ...current,
      provider_config_digest: `sha256:${'1'.repeat(64)}`,
    }),
    BuilderProviderCapabilityManifestError,
  );
  assert.throws(
    () => sanitizeBuilderProviderCapabilityManifest({
      ...current,
      streaming: false,
    }),
    BuilderProviderCapabilityManifestError,
  );
  assert.throws(
    () => admitBuilderProviderCapabilities({
      provider_capability_manifest: current,
      required_capabilities: ['json_output', 'json_output'],
      expected_provider_config_digest: current.provider_config_digest,
      assessed_at_ms: 11,
    }),
    BuilderProviderCapabilityManifestError,
  );
  assert.throws(
    () => admitBuilderProviderCapabilities({
      provider_capability_manifest: current,
      required_capabilities: ['json_output'],
      expected_provider_config_digest: current.provider_config_digest,
      assessed_at_ms: 9,
    }),
    BuilderProviderCapabilityManifestError,
  );
});

test('source remains pure main-side capability evidence without dispatch, secret, IPC, or storage authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-capability-manifest.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(source, /api[_-]?key|Bearer|credential_value|credential_secret|secret_id|secret_store|writeFile|readFile/u);
  assert.doesNotMatch(
    source,
    /provider_dispatch:\s*'performed'|tool_dispatch:\s*'performed'|source_mutation:\s*'performed'|git_mutation:\s*'performed'|sqlite_write:\s*'performed'|permission_grant:\s*'performed'|revision_admission:\s*'performed'|prompt_bridge:\s*'enabled'/u,
  );
  assert.match(source, /provider_dispatch:\s*'not_performed'/u);
  assert.match(source, /credential_readback:\s*'not_performed'/u);
});
