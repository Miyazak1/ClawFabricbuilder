'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  COMPACTION_INPUT_BYTES,
  COMPACTION_MODE,
  COMPACTION_PRIVATE_MARKER,
  DEFAULT_MODE,
  MANUAL_COMPACTION_MODE,
  compactionInput,
  compactionLifecycleEvidence,
  contextUsageLifecycleEvidence,
  isCompactionRequest,
  manualCompactionLifecycleEvidence,
  parseCanaryMode,
} = require('../scripts/verify-builder-harness-coding-loop.cjs');

const root = path.resolve(__dirname, '..');
const configPath = path.join(
  root,
  'electron',
  'harness',
  'builder-coding-loop-compaction-canary.cordis.yml',
);

test('selects compaction canary mode only through the explicit worker argument', () => {
  assert.equal(parseCanaryMode([]), DEFAULT_MODE);
  assert.equal(parseCanaryMode(['--compaction']), COMPACTION_MODE);
  assert.equal(parseCanaryMode(['--manual-compaction']), MANUAL_COMPACTION_MODE);
  assert.throws(() => parseCanaryMode(['--unknown']), /unsupported canary mode/u);
  assert.throws(() => parseCanaryMode(['--compaction', '--extra']), /unsupported canary mode/u);
});

test('creates a bounded high-pressure instruction and detects only Harness summary requests', () => {
  const input = compactionInput();
  assert.equal(Buffer.byteLength(input, 'utf8'), COMPACTION_INPUT_BYTES);
  assert.match(input, /^Update index\.js so ready is true\./u);
  assert.equal(isCompactionRequest({ messages: [{ content: 'ordinary request' }] }), false);
  assert.equal(isCompactionRequest({
    messages: [{ content: 'You are now acting as a compaction engine for this request.' }],
  }), true);
  assert.match(COMPACTION_PRIVATE_MARKER, /^HARNESS_COMPACTION_PRIVATE_/u);
});

test('derives lifecycle evidence from real SDK notification shapes', () => {
  const event = (type, extra = {}) => ({
    method: 'session.event',
    params: { sessionId: 'session-one', event: { type, ...extra } },
  });
  assert.deepEqual(compactionLifecycleEvidence([
    event('compaction/start'),
    event('compaction/summary'),
    event('user/message', {
      surfaceOp: { op: 'replace', start: 0, end: 0 },
      data: { source: { kind: 'compaction' } },
    }),
    event('compaction/end'),
    { method: 'session.status', params: { status: 'idle' } },
  ]), {
    compaction_end_count: 1,
    compaction_start_count: 1,
    compaction_summary_count: 1,
    replacement_count: 1,
  });
});

test('derives manual compaction lifecycle evidence from native turn-null events', () => {
  const sourceCommandId = `builder-context-compaction-admission:${'c'.repeat(64)}`;
  const event = (type, data) => ({
    method: 'session.event',
    params: { sessionId: 'session-one', event: { type, data } },
  });
  assert.deepEqual(manualCompactionLifecycleEvidence([
    event('compaction/start', {
      compactionId: 'compaction:manual-1',
      turn: null,
      sourceCommandId,
    }),
    event('compaction/summary', {
      compactionId: 'compaction:manual-1',
      shadowedTokenCount: 2048,
    }),
    event('compaction/end', {
      compactionId: 'compaction:manual-1',
      turn: null,
      sourceCommandId,
    }),
    event('compaction/start', {
      compactionId: 'compaction:auto-1',
      turn: 1,
    }),
  ], sourceCommandId), {
    manual_compaction_start_count: 1,
    manual_compaction_summary_count: 1,
    manual_compaction_end_count: 1,
    manual_compaction_turn_null_observed: true,
    manual_compaction_source_command_observed: true,
  });
});

test('projects token pressure through compaction and the first refreshed usage', () => {
  const runId = 'builder-run:12345678-1234-4234-8234-123456789abc';
  const event = (eventType, occurredAtMs, payload) => ({
    event_version: 'builder-programming-runtime-event.v1',
    event_type: eventType,
    runtime_kind: 'deepseek_harness.v1',
    run_id: runId,
    turn_id: 'builder-turn:12345678-1234-4234-8234-123456789abc',
    step_id: null,
    tool_call_id: null,
    verification_step_id: null,
    occurred_at_ms: occurredAtMs,
    payload,
  });
  const usage = (
    occurredAtMs,
    pressureTokens,
    projectionSeq,
    totalInputTokens = pressureTokens,
    projectedTokens = pressureTokens,
  ) => event(
    'context_usage_projected',
    occurredAtMs,
    {
      harness_projection_seq: projectionSeq,
      uncached_input_tokens: totalInputTokens,
      output_tokens: 8,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      pressure_tokens: pressureTokens,
      projected_tokens: projectedTokens,
      context_window_tokens: 20_000,
    },
  );

  assert.deepEqual(contextUsageLifecycleEvidence([
    usage(1_000, 17_000, 42),
    usage(1_050, 32, 43, 17_032, 379),
    event('runtime_activity_status', 1_100, {
      activity_kind: 'context_compacting',
      state: 'running',
      status_label: 'Compacting context',
    }),
    event('runtime_activity_status', 1_200, {
      activity_kind: 'context_compacted',
      state: 'completed',
      status_label: 'Context compacted',
    }),
    event('context_compaction_recorded', 1_250, {
      run_id: runId,
      status: 'compaction_completed',
      recorded_at_ms: 1_250,
    }),
    usage(1_300, 32, 52, 17_032, 15_200),
  ]), {
    context_window_tokens: 20_000,
    usage_before_compaction_percent: 85,
    compacting_state_observed: true,
    post_compaction_usage_refresh_observed: true,
    usage_after_compaction_percent: 76,
    usage_drop_observed: true,
  });
});

test('uses an isolated native Harness compaction policy without changing production thresholds', () => {
  const canary = fs.readFileSync(configPath, 'utf8');
  const production = fs.readFileSync(path.join(
    root,
    'electron',
    'harness',
    'builder-coding-loop.cordis.yml',
  ), 'utf8');

  assert.match(canary, /name:\s+'@deepseek-ai\/dsh-token-meter'/u);
  assert.match(canary, /name:\s+'@deepseek-ai\/dsh-session-projection'/u);
  assert.match(canary, /name:\s+'\.\/builder-session-resume-server\.mjs'/u);
  assert.match(canary, /name:\s+'@deepseek-ai\/dsh-compaction-tool-result-pruner'/u);
  assert.match(canary, /name:\s+'@deepseek-ai\/dsh-compaction-basic'/u);
  assert.match(canary, /^\s+contextWindow:\s+20000\s*$/mu);
  assert.match(canary, /^\s+thresholdRatio:\s+0\.9\s*$/mu);
  assert.match(canary, /^\s+retainTokens:\s+1\s*$/mu);
  assert.match(production, /^\s+thresholdRatio:\s+0\.8\s*$/mu);
  assert.match(production, /^\s+retainRatio:\s+0\.16\s*$/mu);
});

test('wires the packaged compaction gate into release verification and package assets', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const verifier = fs.readFileSync(path.join(root, 'scripts', 'verify-package.cjs'), 'utf8');
  const wrapper = fs.readFileSync(
    path.join(root, 'scripts', 'verify-packaged-harness-compaction-canary.cjs'),
    'utf8',
  );

  assert.equal(
    manifest.scripts['verify:harness-compaction'],
    'node scripts/verify-builder-harness-coding-loop.cjs --compaction',
  );
  assert.equal(
    manifest.scripts['verify:harness-manual-compaction'],
    'node scripts/verify-builder-harness-coding-loop.cjs --manual-compaction',
  );
  assert.equal(
    manifest.scripts['verify:packaged-harness-compaction'],
    'node scripts/verify-packaged-harness-compaction-canary.cjs',
  );
  assert.match(manifest.scripts['verify:release'], /verify:packaged-harness-compaction/u);
  assert.match(verifier, /builder-coding-loop-compaction-canary\.cordis\.yml/u);
  assert.match(wrapper, /verify-builder-harness-coding-loop\.cjs/u);
  assert.match(wrapper, /--compaction/u);
  assert.match(wrapper, /--manual-compaction/u);
  assert.match(wrapper, /builder-packaged-harness-compaction-canary\.v1/u);
  assert.match(wrapper, /builder-harness-manual-compaction-canary\.v1/u);
  assert.match(wrapper, /usage_before_compaction_percent:\s*85/u);
  assert.match(wrapper, /usage_after_compaction_percent:\s*76/u);
  assert.match(wrapper, /manual_compaction_closed_failure_observed/u);
});
