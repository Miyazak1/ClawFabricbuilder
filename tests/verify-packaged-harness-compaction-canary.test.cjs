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
  compactionInput,
  compactionLifecycleEvidence,
  isCompactionRequest,
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

test('uses an isolated native Harness compaction policy without changing production thresholds', () => {
  const canary = fs.readFileSync(configPath, 'utf8');
  const production = fs.readFileSync(path.join(
    root,
    'electron',
    'harness',
    'builder-coding-loop.cordis.yml',
  ), 'utf8');

  assert.match(canary, /name:\s+'@deepseek-ai\/dsh-token-meter'/u);
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
    manifest.scripts['verify:packaged-harness-compaction'],
    'node scripts/verify-packaged-harness-compaction-canary.cjs',
  );
  assert.match(manifest.scripts['verify:release'], /verify:packaged-harness-compaction/u);
  assert.match(verifier, /builder-coding-loop-compaction-canary\.cordis\.yml/u);
  assert.match(wrapper, /verify-builder-harness-coding-loop\.cjs/u);
  assert.match(wrapper, /--compaction/u);
  assert.match(wrapper, /builder-packaged-harness-compaction-canary\.v1/u);
});
