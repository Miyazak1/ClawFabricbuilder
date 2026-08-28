'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('emits a redacted deterministic-shape event projection baseline', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'measure-builder-event-projection-baseline.cjs');
  const result = spawnSync(process.execPath, [scriptPath, '--quick'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 30_000,
  });

  assert.equal(result.status, 0, result.stderr);
  const baseline = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(baseline), [
    'baseline_version', 'workload', 'content_policy', 'runtime', 'measurements',
  ]);
  assert.equal(baseline.baseline_version, 'builder-event-projection-baseline.v1');
  assert.equal(baseline.content_policy, 'fixed_synthetic_content_only');
  assert.deepEqual(baseline.measurements.map((item) => item.event_count), [40, 100]);
  for (const measurement of baseline.measurements) {
    assert.deepEqual(Object.keys(measurement), [
      'event_count', 'repetitions', 'median_ms', 'p95_ms', 'maximum_ms',
    ]);
    assert.ok(measurement.median_ms >= 0);
    assert.ok(measurement.p95_ms >= measurement.median_ms);
    assert.ok(measurement.maximum_ms >= measurement.p95_ms);
  }
  assert.doesNotMatch(
    result.stdout,
    /project_id|conversation_id|message_id|prompt|source|command|credential|https?:|[A-Z]:\\/iu,
  );
});

