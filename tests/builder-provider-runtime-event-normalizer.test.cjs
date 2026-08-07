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
  CURRENT_ADAPTER_ID,
  describeBuilderProviderProtocolAdapter,
} = require('../electron/builder-provider-protocol-adapter-descriptor.cjs');
const {
  BuilderProviderRuntimeEventNormalizerError,
  normalizeBuilderProviderRuntimeEvent,
  sanitizeBuilderProviderRuntimeEvent,
} = require('../electron/builder-provider-runtime-event-normalizer.cjs');

const PRIVATE_TEXT = 'private-provider-output-marker';

function secretRef() {
  return {
    ref_version: 'builder-provider-secret-ref.v1',
    provider_id: 'builder-default',
    secret_id: 'builder-provider-secret:default',
  };
}

function providerConfig() {
  return createBuilderProviderConfig({
    base_url: 'https://provider.example/v1',
    model: 'builder-model',
    timeout_ms: 60000,
    temperature: 0.2,
    max_tokens: 8192,
    secret_ref: secretRef(),
  });
}

function descriptor(requiredCapabilities = ['json_output', 'streaming']) {
  const config = providerConfig();
  const manifest = createBuilderProviderCapabilityManifest({
    provider_config: config,
    protocol_family: 'openai_chat_completions.v1',
    assessed_at_ms: 10,
  });
  const admission = admitBuilderProviderCapabilities({
    provider_capability_manifest: manifest,
    required_capabilities: requiredCapabilities,
    expected_provider_config_digest: config.config_digest,
    assessed_at_ms: 11,
  });
  return describeBuilderProviderProtocolAdapter({
    provider_capability_manifest: manifest,
    provider_capability_admission: admission,
    adapter_family: CURRENT_ADAPTER_ID,
    described_at_ms: 12,
  });
}

function adapterEvent(event_kind, payload, overrides = {}) {
  return {
    event_version: 'builder-provider-adapter-event.v1',
    event_kind,
    event_index: overrides.event_index ?? 0,
    occurred_at_ms: overrides.occurred_at_ms ?? 20,
    payload,
  };
}

function normalize(event, overrides = {}) {
  return normalizeBuilderProviderRuntimeEvent({
    provider_protocol_adapter_descriptor: overrides.descriptor ?? descriptor(),
    adapter_event: event,
    normalized_at_ms: overrides.normalized_at_ms ?? 21,
  });
}

test('normalizes request start, display delta, completion, and failure events into stable runtime events', () => {
  const started = normalize(adapterEvent('request_started', { request_mode: 'streaming' }));
  assert.equal(started.result_version, 'builder-provider-runtime-event.v1');
  assert.match(started.normalized_event_id, /^builder-provider-runtime-event:[0-9a-f]{64}$/u);
  assert.equal(started.event_kind, 'provider_request_started');
  assert.deepEqual(started.payload, { request_mode: 'streaming' });
  assert.equal(started.authority.provider_dispatch, 'not_performed');
  assert.deepEqual(sanitizeBuilderProviderRuntimeEvent(structuredClone(started)), started);

  const delta = normalize(adapterEvent('text_delta', { delta_text: 'Planning a compact timer.' }, { event_index: 1 }));
  assert.equal(delta.event_kind, 'provider_text_delta');
  assert.deepEqual(delta.payload, {
    display_delta_text: 'Planning a compact timer.',
    display_delta_bytes: Buffer.byteLength('Planning a compact timer.', 'utf8'),
  });

  const completed = normalize(adapterEvent('response_completed', {
    transport_version: 'builder-openai-compatible-transport.v1',
    generated_text: JSON.stringify({ kind: 'builder_code_project', summary: PRIVATE_TEXT }),
  }, { event_index: 2 }));
  assert.equal(completed.event_kind, 'provider_response_completed');
  assert.equal(completed.payload.transport_version, 'builder-openai-compatible-transport.v1');
  assert.match(completed.payload.generated_text_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    completed.payload.generated_text_bytes,
    Buffer.byteLength(JSON.stringify({ kind: 'builder_code_project', summary: PRIVATE_TEXT }), 'utf8'),
  );
  assert.doesNotMatch(JSON.stringify(completed), /private-provider-output-marker|builder_code_project|summary/iu);

  const failed = normalize(adapterEvent('response_failed', {
    failure_code: 'timeout',
    retryable: true,
  }, { event_index: 3 }));
  assert.equal(failed.event_kind, 'provider_response_failed');
  assert.deepEqual(failed.payload, {
    failure_code: 'timeout',
    retryable: true,
  });
});

test('normalizes non-streaming request start but rejects stream deltas when the descriptor did not admit streaming', () => {
  const nonStreaming = descriptor(['json_output']);
  const started = normalize(adapterEvent('request_started', { request_mode: 'non_streaming' }), {
    descriptor: nonStreaming,
  });
  assert.equal(started.event_kind, 'provider_request_started');
  assert.deepEqual(started.payload, { request_mode: 'non_streaming' });

  assert.throws(
    () => normalize(adapterEvent('request_started', { request_mode: 'streaming' }), {
      descriptor: nonStreaming,
    }),
    BuilderProviderRuntimeEventNormalizerError,
  );
  assert.throws(
    () => normalize(adapterEvent('text_delta', { delta_text: 'Should not stream.' }), {
      descriptor: nonStreaming,
    }),
    BuilderProviderRuntimeEventNormalizerError,
  );
});

test('fails closed for unknown events, raw envelope-shaped payloads, bad transport versions, and future timestamps', () => {
  assert.throws(
    () => normalize({
      ...adapterEvent('text_delta', { delta_text: 'ok' }),
      event_kind: 'unknown_event',
    }),
    BuilderProviderRuntimeEventNormalizerError,
  );
  assert.throws(
    () => normalize(adapterEvent('text_delta', {
      delta_text: 'ok',
      raw_provider_envelope: { choices: [] },
    })),
    BuilderProviderRuntimeEventNormalizerError,
  );
  assert.throws(
    () => normalize(adapterEvent('response_completed', {
      transport_version: 'builder-openai-responses-transport.v1',
      generated_text: '{}',
    })),
    BuilderProviderRuntimeEventNormalizerError,
  );
  assert.throws(
    () => normalize(adapterEvent('response_failed', {
      failure_code: 'provider_secret_leaked',
      retryable: false,
    })),
    BuilderProviderRuntimeEventNormalizerError,
  );
  assert.throws(
    () => normalize(adapterEvent('request_started', { request_mode: 'streaming' }, { occurred_at_ms: 30 }), {
      normalized_at_ms: 29,
    }),
    BuilderProviderRuntimeEventNormalizerError,
  );
});

test('fails closed for forged normalized events and raw generated text replay attempts', () => {
  const current = normalize(adapterEvent('response_completed', {
    transport_version: 'builder-openai-compatible-transport.v1',
    generated_text: '{}',
  }));

  assert.throws(
    () => sanitizeBuilderProviderRuntimeEvent({
      ...current,
      payload: {
        ...current.payload,
        generated_text: '{}',
      },
    }),
    BuilderProviderRuntimeEventNormalizerError,
  );
  assert.throws(
    () => sanitizeBuilderProviderRuntimeEvent({
      ...current,
      authority: {
        ...current.authority,
        provider_dispatch: 'performed',
      },
    }),
    BuilderProviderRuntimeEventNormalizerError,
  );
});

test('source remains a pure event normalizer without network, secret, renderer, storage, or mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-runtime-event-normalizer.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(source, /api[_-]?key|Bearer|credential_value|credential_secret|secret_id|secret_store|writeFile|readFile/u);
  assert.doesNotMatch(
    source,
    /provider_dispatch:\s*'performed'|tool_dispatch:\s*'performed'|source_mutation:\s*'performed'|git_mutation:\s*'performed'|sqlite_write:\s*'performed'|permission_grant:\s*'performed'|revision_admission:\s*'performed'|prompt_bridge:\s*'enabled'/u,
  );
  assert.match(source, /raw_provider_envelope:\s*'not_accepted'/u);
  assert.match(source, /provider_dispatch:\s*'not_performed'/u);
});
