'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PNG } = require('pngjs');
const { PLAN, UPDATE, validateEvidence } = require('../scripts/verify-deepseek-packaged-preview-closure.cjs');

function evidence() {
  const png = new PNG({ width: 64, height: 1 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = i; png.data[i + 3] = 255;
  }
  return { before: { state: 'idle', canvas_hash: 1 },
    after: { h1: 'Agent History Flow', text: 'Second Agent Task', state: 'running', painted: 80,
      canvas_hash: 2, width: 320, height: 600, overflow: false },
    bounds: { width: 320, height: 600 }, image: PNG.sync.write(png).toString('base64') };
}

test('accepts a native page with real input, moving canvas and matching bounds', () => {
  validateEvidence(evidence(), 'Second Agent Task', true);
});

test('rejects text-only success, stale content, frozen canvas and hidden overflow', () => {
  for (const change of [{ h1: 'Wrong page' }, { text: 'Preview first version' }, { state: 'idle' },
    { painted: 0 }, { canvas_hash: 1 }, { overflow: true }, { width: 800 }]) {
    const value = evidence();
    Object.assign(value.after, change);
    assert.throws(() => validateEvidence(value, 'Second Agent Task', true));
  }
});

test('requests generated interactive behavior and preserves it on revision without dependencies', () => {
  assert.match(PLAN, /no dependencies/u);
  assert.match(PLAN, /button#preview-start/u);
  assert.match(PLAN, /requestAnimationFrame/u);
  assert.match(UPDATE, /preserve all interactive behavior and the canvas/u);
});
