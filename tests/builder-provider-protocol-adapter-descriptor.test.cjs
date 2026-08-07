'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  admitBuilderProviderCapabilities,
  createBuilderProviderCapabilityManifest,
} = require('../electron/builder-provider-capability-manifest.cjs');
const {
  BuilderProviderProtocolAdapterDescriptorError,
  CURRENT_ADAPTER_ID,
  describeBuilderProviderProtocolAdapter,
  sanitizeBuilderProviderProtocolAdapterDescriptor,
} = require('../electron/builder-provider-protocol-adapter-descriptor.cjs');

function secretRef() {
  return {
    ref_version: 'builder-provider-secret-ref.v1',
    provider_id: 'builder-default',
    secret_id: 'builder-provider-secret:default',
  };
}

function providerConfig(overrides = {}) {
  return createBuilderProviderConfig({
    base_url: 'https://provider.example/v1',
    model: 'builder-model',
    timeout_ms: 60000,
    temperature: 0.2,
    max_tokens: 8192,
    secret_ref: secretRef(),
    ...overrides,
  });
}

function manifestAndAdmission(requiredCapabilities = ['json_output', 'streaming'], overrides = {}) {
  const config = providerConfig(overrides.provider_config_overrides ?? {});
  const manifest = createBuilderProviderCapabilityManifest({
    provider_config: config,
    protocol_family: 'openai_chat_completions.v1',
    assessed_at_ms: overrides.manifest_assessed_at_ms ?? 10,
  });
  const admission = admitBuilderProviderCapabilities({
    provider_capability_manifest: manifest,
    required_capabilities: requiredCapabilities,
    expected_provider_config_digest: config.config_digest,
    assessed_at_ms: overrides.admission_assessed_at_ms ?? 11,
  });
  return { admission, config, manifest };
}

function descriptor(requiredCapabilities = ['json_output', 'streaming'], overrides = {}) {
  const { admission, manifest } = manifestAndAdmission(requiredCapabilities, overrides);
  return describeBuilderProviderProtocolAdapter({
    provider_capability_manifest: manifest,
    provider_capability_admission: admission,
    adapter_family: CURRENT_ADAPTER_ID,
    described_at_ms: overrides.described_at_ms ?? 12,
  });
}

test('describes the current OpenAI-compatible Chat Completions adapter without dispatching it', () => {
  const current = descriptor();

  assert.equal(current.result_version, 'builder-provider-protocol-adapter-descriptor.v1');
  assert.match(current.descriptor_id, /^builder-provider-protocol-adapter-descriptor:[0-9a-f]{64}$/u);
  assert.equal(current.adapter_id, CURRENT_ADAPTER_ID);
  assert.equal(current.adapter_family, 'openai_compatible_chat_completions');
  assert.equal(current.protocol_family, 'openai_chat_completions.v1');
  assert.equal(current.transport_version, 'builder-openai-compatible-transport.v1');
  assert.deepEqual(current.required_capabilities, ['json_output', 'streaming']);
  assert.deepEqual(current.request_shape, {
    kind: 'messages_json_object',
    status: 'current_transport',
  });
  assert.deepEqual(current.response_shape, {
    kind: 'choices_message_content',
    status: 'current_transport',
  });
  assert.deepEqual(current.stream_shape, {
    kind: 'sse_choices_delta',
    status: 'current_transport',
  });
  assert.deepEqual(current.tool_call_shape, {
    kind: 'not_admitted',
    status: 'blocked_by_capability_manifest',
  });
  assert.deepEqual(current.usage_shape, {
    kind: 'not_normalized',
    status: 'not_available',
  });
  assert.equal(current.authority.provider_dispatch, 'not_performed');
  assert.equal(current.authority.credential_readback, 'not_performed');
  assert.equal(Object.isFrozen(current), true);
  assert.equal(Object.isFrozen(current.request_shape), true);
  assert.deepEqual(sanitizeBuilderProviderProtocolAdapterDescriptor(structuredClone(current)), current);
  assert.doesNotMatch(
    JSON.stringify(current),
    /provider\.example|builder-provider-secret|secret_ref|credential_(?:secret|value)|api[_-]?key|Bearer|provider-key/iu,
  );
});

test('describes non-streaming use of the same adapter when streaming is not requested', () => {
  const current = descriptor(['json_output']);

  assert.deepEqual(current.required_capabilities, ['json_output']);
  assert.deepEqual(current.stream_shape, {
    kind: 'not_required',
    status: 'not_requested',
  });
  assert.equal(current.protocol_family, 'openai_chat_completions.v1');
  assert.equal(current.transport_version, 'builder-openai-compatible-transport.v1');
});

test('fails closed on adapter, manifest, admission, digest, and freshness drift', () => {
  const { admission, manifest } = manifestAndAdmission();

  assert.throws(
    () => describeBuilderProviderProtocolAdapter({
      provider_capability_manifest: manifest,
      provider_capability_admission: admission,
      adapter_family: 'builder-provider-protocol-adapter:openai-responses-v1',
      described_at_ms: 12,
    }),
    BuilderProviderProtocolAdapterDescriptorError,
  );
  assert.throws(
    () => describeBuilderProviderProtocolAdapter({
      provider_capability_manifest: {
        ...manifest,
        protocol_family: 'openai_responses.v1',
      },
      provider_capability_admission: admission,
      adapter_family: CURRENT_ADAPTER_ID,
      described_at_ms: 12,
    }),
    BuilderProviderProtocolAdapterDescriptorError,
  );
  assert.throws(
    () => describeBuilderProviderProtocolAdapter({
      provider_capability_manifest: manifest,
      provider_capability_admission: {
        ...admission,
        provider_config_digest: `sha256:${'f'.repeat(64)}`,
      },
      adapter_family: CURRENT_ADAPTER_ID,
      described_at_ms: 12,
    }),
    BuilderProviderProtocolAdapterDescriptorError,
  );
  assert.throws(
    () => describeBuilderProviderProtocolAdapter({
      provider_capability_manifest: manifest,
      provider_capability_admission: admission,
      adapter_family: CURRENT_ADAPTER_ID,
      described_at_ms: 10,
    }),
    BuilderProviderProtocolAdapterDescriptorError,
  );
});

test('fails closed for forged descriptor shapes and executable tool claims', () => {
  const current = descriptor();

  assert.throws(
    () => sanitizeBuilderProviderProtocolAdapterDescriptor({
      ...current,
      transport_version: 'builder-openai-responses-transport.v1',
    }),
    BuilderProviderProtocolAdapterDescriptorError,
  );
  assert.throws(
    () => sanitizeBuilderProviderProtocolAdapterDescriptor({
      ...current,
      tool_call_shape: {
        kind: 'openai_tool_calls',
        status: 'current_transport',
      },
    }),
    BuilderProviderProtocolAdapterDescriptorError,
  );
  assert.throws(
    () => sanitizeBuilderProviderProtocolAdapterDescriptor({
      ...current,
      authority: {
        ...current.authority,
        provider_dispatch: 'performed',
      },
    }),
    BuilderProviderProtocolAdapterDescriptorError,
  );
});

test('source remains a pure adapter descriptor without network, secret, renderer, storage, or mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-protocol-adapter-descriptor.cjs'),
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
  assert.match(source, /tool_dispatch:\s*'not_performed'/u);
});
